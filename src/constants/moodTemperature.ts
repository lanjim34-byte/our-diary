export type MoodTone = "very_dark" | "dark" | "middle" | "bright" | "very_bright";

export type MoodToneOption = {
  key: MoodTone;
  label: string;
  words: string[];
};

export const moodToneOptions: MoodToneOption[] = [
  {
    key: "very_dark",
    label: "暗暗嘟",
    words: ["难过", "委屈", "空空的", "想哭", "低落", "害怕", "孤单", "没力气"],
  },
  {
    key: "dark",
    label: "有点暗",
    words: ["有点累", "烦躁", "不安", "闷闷的", "卡住了", "想躲起来", "心乱", "撑着"],
  },
  {
    key: "middle",
    label: "中间晃晃",
    words: ["平静", "还好", "慢慢来", "发呆", "安稳", "普通", "松了一点", "没什么"],
  },
  {
    key: "bright",
    label: "有点亮",
    words: ["开心", "期待", "有劲", "安心", "轻快", "被接住", "想聊天", "有希望"],
  },
  {
    key: "very_bright",
    label: "亮亮嘟",
    words: ["兴奋", "热忱", "欢乐", "勇敢", "自豪", "闪闪的", "想冲", "好喜欢"],
  },
];

export function getMoodToneOption(value?: string | null) {
  return moodToneOptions.find((option) => option.key === value) ?? null;
}

export function moodToneFromIndex(index: number) {
  return moodToneOptions[Math.max(0, Math.min(index, moodToneOptions.length - 1))].key;
}

export function moodToneIndex(value?: string | null) {
  const index = moodToneOptions.findIndex((option) => option.key === value);
  return index >= 0 ? index : 2;
}

export function moodToneFromValue(value: number) {
  const bounded = Math.max(0, Math.min(100, value));
  if (bounded <= 20) return "very_dark";
  if (bounded <= 40) return "dark";
  if (bounded <= 60) return "middle";
  if (bounded <= 80) return "bright";
  return "very_bright";
}
