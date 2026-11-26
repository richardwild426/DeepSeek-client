import { Canvas, colorScheme, Path2D, Text, View } from "nsh";

const palettes = {
  light: {
    canvas: "#ffffff", rail: "#f9fafb", surface: "#ffffff", inset: "#f1f3f5",
    ink: "#10141a", muted: "#848a94", placeholder: "#a8aeb8", line: "#e5e5e5",
    railLine: "#eff0f1", selectedLine: "#d4d6d8", accent: "#3964fe", accentSoft: "#e9efff",
    navSelected: "#f1f3f5", raised: "#ffffff", controlLine: "#e5e5e5",
    onAccent: "#ffffff", disabledAccent: "#afc1ff", onDisabledAccent: "#ffffff",
    danger: "#ff2424", veil: "rgba(0,0,0,0.36)",
  },
  dark: {
    canvas: "#151517", rail: "#1b1b1c", surface: "#2c2c2e", inset: "#43454a",
    ink: "#f9fafb", muted: "#adb2b8", placeholder: "#858991", line: "#38383a",
    railLine: "#282829", selectedLine: "#5a5c60", accent: "#5686fe", accentSoft: "#2b3657",
    navSelected: "#3d3d3e", raised: "#43454a", controlLine: "#464647",
    onAccent: "#ffffff", disabledAccent: "#3d5081", onDisabledAccent: "#858991",
    danger: "#f25a5a", veil: "rgba(0,0,0,0.60)",
  },
};
export const colors = () => palettes[colorScheme()];

const paths = {
  menu: "M4 7h16M4 17h9",
  panel: "M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm3 0v18",
  new: "M4 16a9 9 0 1 1 4 4l-4 1 1-4m4-5h6m-3-3v6",
  settings: "M10 3h4l1 3 3 1 3 1v4l-2 2v3l-3 3-3-1-2 2-4-2v-3l-3-2V9l3-1 1-3 2-2Zm5 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  data: "M20 6c0 2-4 3-9 3S2 8 2 6s4-3 9-3 9 1 9 3Zm0 0v5M2 6v12c0 2 4 3 9 3M2 12c0 2 4 3 9 3m8-1v8m-4-4h8m-1 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  close: "m6 6 12 12M18 6 6 18",
  sun: "M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19m0-14-1.5 1.5m-11 11L5 19m12-7a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z",
  moon: "M21 13A9 9 0 1 1 11 3a6 6 0 0 0 10 10Z",
  system: "M6 4h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm2 17h8",
  chevron: "m6 9 6 6 6-6",
  thinking: "M20 4c5 5-11 21-16 16S15-1 20 4Zm0 16C15 25-1 9 4 4S25 15 20 20Zm-8-8h.05",
  search: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-18 0h18m-5 0a4 9 0 1 1-8 0 4 9 0 0 1 8 0Z",
  link: "m10 14 4-4m-6 6-1 1a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0m2 8a3.5 3.5 0 0 0 5 0l4-4a3.5 3.5 0 0 0-5-5l-1 1",
  mic: "M12 2a4 4 0 0 1 4 4v5a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4Zm-7 9a7 7 0 0 0 14 0m-7 7v4",
  attach: "M19 7v8a7 7 0 0 1-14 0V7a4.5 4.5 0 0 1 9 0v8a2 2 0 0 1-4 0V8",
  send: "M12 21V4m-7 7 7-7 7 7",
  stop: "M6 6h12v12H6Z",
  upload: "M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4M12 15V4m-5 5 5-5 5 5",
  copy: "M8 8h12v13H8ZM4 16V3h12",
  check: "m5 12 4 4L19 6",
};

type IconName = keyof typeof paths;

export function Icon(props: { name: IconName; size?: number; color?: string }) {
  const size = () => props.size ?? 16;
  return <Canvas class="shrink-0" style={{ width: size(), height: size() }} draw={(ctx) => {
    ctx.scale(size() / 24, size() / 24);
    ctx.strokeStyle = props.color ?? colors().ink;
    ctx.lineWidth = props.name === "send" ? 2.5 : 1.8;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke(new Path2D(paths[props.name]));
  }} />;
}

export function IconButton(props: {
  testID: string; label: string; name: IconName; action: () => void; disabled?: boolean;
  size?: number; iconSize?: number; color?: string; fill?: string; selected?: boolean;
}) {
  return <View testID={props.testID} role="button" accessibilityLabel={props.label}
    accessibilityState={{ disabled: props.disabled, pressed: props.selected }} onPress={props.disabled ? undefined : props.action}
    class="shrink-0 items-center justify-center rounded-full"
    style={{ width: props.size ?? 34, height: props.size ?? 34, backgroundColor: props.fill }}>
    <Icon name={props.name} size={props.iconSize} color={props.color} />
  </View>;
}

export function Toggle(props: {
  key?: string; label: string; testID: string; selected: boolean; action: () => void; icon?: IconName;
}) {
  const tone = () => props.selected ? colors().accent : colors().ink;
  return <View testID={props.testID} role="button" accessibilityState={{ pressed: props.selected }} onPress={props.action}
    class="h-[34px] shrink-0 flex-row items-center justify-center gap-1 rounded-full border px-3"
    style={{ borderColor: props.selected ? colors().accent : colors().controlLine, backgroundColor: props.selected ? colors().accentSoft : colors().surface }}>
    {props.icon ? <Icon name={props.icon} size={14} color={tone()} /> : null}
    <Text class="text-[13px] font-medium" style={{ color: tone() }}>{props.label}</Text>
  </View>;
}

export function Action(props: {
  label: string; testID: string; action: () => void; disabled?: boolean; danger?: boolean;
  height?: number; icon?: IconName;
}) {
  const tone = () => props.disabled ? colors().muted : props.danger ? colors().danger : colors().ink;
  return <View testID={props.testID} role="button" accessibilityState={{ disabled: props.disabled }}
    onPress={props.disabled ? undefined : props.action}
    class="min-w-[72px] shrink-0 flex-row items-center justify-center gap-1 rounded-full border px-3"
    style={{ height: props.height ?? 36, borderColor: props.disabled ? colors().line : props.danger ? colors().danger : colors().controlLine }}>
    {props.icon ? <Icon name={props.icon} size={14} color={tone()} /> : null}
    <Text class="text-sm" style={{ color: tone() }}>{props.label}</Text>
  </View>;
}
