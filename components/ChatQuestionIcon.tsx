import Svg, { Circle, Path } from 'react-native-svg';

/**
 * A speech bubble with a question mark — Ionicons (the icon set every
 * other tab uses) has no "chat question" glyph, so this hand-drawn SVG
 * matches its outline family instead: single-color stroke, rounded
 * caps/joins, no fill except the question mark's dot (same treatment
 * Ionicons uses for e.g. "help-circle-outline").
 */
export function ChatQuestionIcon({ size = 24, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 5.5C4 4.67 4.67 4 5.5 4h13c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H9.5l-3.7 3.2c-.5.43-1.3.08-1.3-.58V17H5.5C4.67 17 4 16.33 4 15.5v-10Z"
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <Path
        d="M9.6 9.3c0-1.25 1.05-2.2 2.4-2.2s2.4.86 2.4 2c0 .95-.55 1.4-1.2 1.85-.6.4-1.05.75-1.05 1.45"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={14.1} r={0.9} fill={color} />
    </Svg>
  );
}
