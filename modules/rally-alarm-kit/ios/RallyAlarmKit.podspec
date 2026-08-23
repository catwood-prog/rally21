require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'RallyAlarmKit'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = 'UNLICENSED'
  s.author         = 'Rally21'
  s.homepage       = 'https://rally21.com'

  # AK1 job 1a, re-ruled by Cat 23 Aug: HOLD THE FLOOR. AlarmKit is
  # WEAK-LINKED and every use site is gated behind
  # `#if canImport(AlarmKit)` + `if #available(iOS 26.0, *)`, so this pod
  # deliberately does NOT declare :ios => '26.0'. Declaring 26 here would
  # drag the whole app's deployment target up with it and make Rally21
  # uninstallable below iOS 26 — 21% of iPhones as of Apple's 7 June 2026
  # App Store figures (79% on iOS 26).
  #
  # 15.1 is the app's real floor today (React Native 0.81.5's
  # min_ios_version_supported, and expo-build-properties' default; app.json
  # sets no ios.deploymentTarget). The community Nitro module proves the
  # pattern compiles at a pod platform of 18.0; 15.1 is NOT yet proven,
  # and the first `eas build` is what settles it. If the compiler refuses
  # 15.1, raise this ONE line to exactly what it demands (18.0 expected)
  # and report the number — do not jump to 26.0.
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://rally21.com/rally-alarm-kit.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
