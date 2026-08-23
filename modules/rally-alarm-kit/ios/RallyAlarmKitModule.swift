import ExpoModulesCore
import SwiftUI

// AK1 job 3 — Rally21's own thin AlarmKit binding.
//
// WHY OURS AND NOT A COMMUNITY PACKAGE (job 1b, accepted by Cat 23 Aug).
// Four packages exist; the largest has 310 weekly downloads and all are
// one person's spare time. The best-licensed (react-native-nitro-ios-
// alarm-kit, MIT) drags in the whole Nitro Modules runtime and carries an
// open unresolved bug in its core scheduling path; expo-alarm-kit's
// podspec alone declares :ios => '26.1', which would make the deployment-
// target decision for us in the most expensive direction. AK1 needs six
// calls. This file is those six calls.
//
// THE WEAK-LINK PATTERN, and it is the whole reason the app's floor can
// stay at 15.1 (Cat's ruling, 23 Aug). `#if canImport(AlarmKit)` is
// evaluated against the SDK, not the deployment target, so it is true
// whenever the build machine has the iOS 26 SDK; `if #available(iOS 26.0,
// *)` is the runtime gate. Every single AlarmKit type in this file sits
// inside BOTH. Nothing at file scope names an AlarmKit type, which is
// what lets the module compile for a device that will never run it.
//
// NOT COMPILED IN THE SESSION THAT WROTE IT — said plainly rather than
// implied. The authoring machine had Command Line Tools only (no Xcode,
// no iOS SDK), so the first `eas build` is the first compile, and it is
// also what settles whether 15.1 holds or has to rise to 18.0. See the
// podspec's note.
#if canImport(AlarmKit)
import AlarmKit
#endif

/// The alarm's metadata payload. Apple: "The implementation can be empty
/// if you don't want to provide any additional data for your alarm UI."
/// We do not — the circle is identified by the alarm's id, which is the
/// membership id, so nothing needs to ride in the attributes.
#if canImport(AlarmKit)
@available(iOS 26.0, *)
struct RallyAlarmMetadata: AlarmMetadata {
  init() {}
}
#endif

/// Thrown when iOS refuses a new alarm. AK1 job 7: this MUST reach
/// JavaScript as its own distinguishable code, because the toggle's
/// on-state is driven by the schedule succeeding and a swallowed refusal
/// is PN2's granted-but-unregistered trap in a new costume.
final class MaxAlarmsReachedException: Exception {
  override var reason: String {
    "iOS refused another alarm for this app (AlarmKit maximumLimitReached)"
  }
}

/// Thrown when the caller asks for an alarm on a device that has no
/// AlarmKit. The JS side fences this off first (see index.ts), so
/// reaching here means the fence leaked.
final class AlarmKitUnavailableException: Exception {
  override var reason: String {
    "AlarmKit needs iOS 26 or later"
  }
}

final class InvalidAlarmIdException: GenericException<String> {
  override var reason: String { "not a valid alarm id: \(param)" }
}

public class RallyAlarmKitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RallyAlarmKit")

    // THE FENCE, at module level (AK1 job 3 / AL1 job 4's precedent).
    // False on every iOS below 26 and — because the module only builds
    // for apple — absent entirely on Android and web, where the JS side
    // never even loads it.
    Function("isAvailable") { () -> Bool in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) { return true }
      return false
      #else
      return false
      #endif
    }

    AsyncFunction("getAuthorizationState") { () -> String in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        return Self.stateString(AlarmManager.shared.authorizationState)
      }
      #endif
      return "unavailable"
    }

    // AK1 job 4 — the EARNED MOMENT. This is only ever called from the
    // turn-a-circle's-alarm-ON tap, never on launch (PN1's law). Apple
    // would otherwise request authorization implicitly on the first
    // schedule; calling it explicitly here is what lets us own the moment
    // and tell the difference between "denied" and "refused for another
    // reason" before anything is written.
    AsyncFunction("requestAuthorization") { () -> String in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        let state = try await AlarmManager.shared.requestAuthorization()
        return Self.stateString(state)
      }
      #endif
      return "unavailable"
    }

    // ONE RECURRING ALARM PER MEMBERSHIP. `weekdays` is the FULL set that
    // should fire, recomputed from scratch by the caller every time — see
    // lib/circleAlarm.ts. Scheduling the same id again REPLACES it, which
    // is what makes the recompute idempotent and self-healing.
    //
    // Apple's Recurrence has exactly two cases, `never` and `weekly(_:)`.
    // An empty weekday set therefore cannot mean "never fire" via
    // recurrence — the caller cancels instead, and we refuse the empty
    // set rather than silently arming a one-shot.
    AsyncFunction("scheduleWeeklyAlarm") {
      (id: String, hour: Int, minute: Int, weekdays: [Int], title: String, stopButtonText: String) -> Void in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        guard let uuid = UUID(uuidString: id) else {
          throw InvalidAlarmIdException(id)
        }

        let alert = AlarmPresentation.Alert(
          title: LocalizedStringResource(stringLiteral: title),
          stopButton: AlarmButton(
            text: LocalizedStringResource(stringLiteral: stopButtonText),
            textColor: .black,
            systemImageName: "checkmark"
          )
        )

        // Alert state ONLY — no countdown, no paused. Apple's own sample:
        // "An alarm without countdown specifies only an alert state."
        // That is also why AK1 needs no widget extension target: the
        // widget in Apple's sample exists for the countdown Live
        // Activity, which we do not have.
        let attributes = AlarmAttributes<RallyAlarmMetadata>(
          presentation: AlarmPresentation(alert: alert),
          metadata: RallyAlarmMetadata(),
          // The app's own yellow (#F4C84B), so a Rally21 alarm is
          // visibly ours on a lock screen that may hold several.
          tintColor: Color(red: 244.0 / 255.0, green: 200.0 / 255.0, blue: 75.0 / 255.0)
        )

        let mapped = weekdays.compactMap { Self.weekday(fromJSDay: $0) }
        guard mapped.count == weekdays.count, !mapped.isEmpty else {
          throw InvalidAlarmIdException("weekday set \(weekdays)")
        }

        let schedule = Alarm.Schedule.Relative(
          time: Alarm.Schedule.Relative.Time(hour: hour, minute: minute),
          repeats: .weekly(mapped)
        )

        let configuration = AlarmManager.AlarmConfiguration(
          countdownDuration: nil,
          schedule: .relative(schedule),
          attributes: attributes,
          sound: .default
        )

        do {
          _ = try await AlarmManager.shared.schedule(id: uuid, configuration: configuration)
        } catch AlarmManager.AlarmError.maximumLimitReached {
          // JOB 7. Distinguishable on purpose.
          throw MaxAlarmsReachedException()
        }
        return
      }
      #endif
      throw AlarmKitUnavailableException()
    }

    // Cancelling matters as much as setting (job 3): toggle off, leaving
    // a circle and finishing a membership all land here. Apple:
    // "Deletes the alarm from the system even if the alarm has a
    // repeating schedule." Cancelling an id that is not scheduled is a
    // no-op rather than an error, so the reconcile pass can cancel
    // freely.
    AsyncFunction("cancelAlarm") { (id: String) -> Void in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        guard let uuid = UUID(uuidString: id) else {
          throw InvalidAlarmIdException(id)
        }
        try? AlarmManager.shared.cancel(id: uuid)
        return
      }
      #endif
      // Below 26 there is nothing to cancel, and saying so as an error
      // would make every sign-out on an old phone throw.
      return
    }

    // The reconciliation read. This is what makes the recompute
    // self-healing rather than hopeful: it is the SYSTEM's list, so an
    // alarm the database has forgotten (a circle left while the app was
    // offline) is still visible here and can be cancelled.
    AsyncFunction("listAlarmIds") { () -> [String] in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        let alarms = (try? AlarmManager.shared.alarms) ?? []
        return alarms.map { $0.id.uuidString }
      }
      #endif
      return []
    }
  }

  #if canImport(AlarmKit)
  @available(iOS 26.0, *)
  private static func stateString(_ state: AlarmManager.AuthorizationState) -> String {
    switch state {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .notDetermined: return "notDetermined"
    @unknown default: return "notDetermined"
    }
  }

  /// JS `Date.getDay()` convention — 0 = Sunday … 6 = Saturday — mapped
  /// to Apple's `Locale.Weekday`. Kept in JS's numbering rather than
  /// ISO's so lib/circleAlarm.ts can hand `getDay()` straight through
  /// with no arithmetic to get wrong at the boundary.
  @available(iOS 26.0, *)
  private static func weekday(fromJSDay day: Int) -> Locale.Weekday? {
    switch day {
    case 0: return .sunday
    case 1: return .monday
    case 2: return .tuesday
    case 3: return .wednesday
    case 4: return .thursday
    case 5: return .friday
    case 6: return .saturday
    default: return nil
    }
  }
  #endif
}
