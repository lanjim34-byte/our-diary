export type UserColorKey =
  | "warm_brown"
  | "moss_green"
  | "dusty_blue"
  | "muted_rose"
  | "soft_ochre"
  | "lavender_gray"
  | "mist_teal"
  | "clay_peach";

export type UserColor = {
  key: UserColorKey;
  name: string;
  base: string;
  paper: string;
  light: string;
  highlight: string;
};

export const userColors: UserColor[] = [
  {
    key: "warm_brown",
    name: "暖栗",
    base: "#B9855A",
    paper: "#FFF4E7",
    light: "#E8D0B8",
    highlight: "rgba(185, 133, 90, 0.22)",
  },
  {
    key: "moss_green",
    name: "苔绿",
    base: "#8DA36B",
    paper: "#F4F8EC",
    light: "#DCE7C9",
    highlight: "rgba(141, 163, 107, 0.22)",
  },
  {
    key: "dusty_blue",
    name: "雾蓝",
    base: "#7D9DB5",
    paper: "#F2F8FB",
    light: "#D5E5EE",
    highlight: "rgba(125, 157, 181, 0.22)",
  },
  {
    key: "muted_rose",
    name: "旧粉",
    base: "#C48A8A",
    paper: "#FFF3F3",
    light: "#EBCFCF",
    highlight: "rgba(196, 138, 138, 0.22)",
  },
  {
    key: "soft_ochre",
    name: "蜜黄",
    base: "#C5A15A",
    paper: "#FFF8E8",
    light: "#EEDFAF",
    highlight: "rgba(197, 161, 90, 0.24)",
  },
  {
    key: "lavender_gray",
    name: "灰紫",
    base: "#9A8DAE",
    paper: "#F8F4FC",
    light: "#E1D9EC",
    highlight: "rgba(154, 141, 174, 0.22)",
  },
  {
    key: "mist_teal",
    name: "雾青",
    base: "#78A39A",
    paper: "#F1F8F6",
    light: "#CFE5E0",
    highlight: "rgba(120, 163, 154, 0.22)",
  },
  {
    key: "clay_peach",
    name: "陶桃",
    base: "#C18B6B",
    paper: "#FFF2EA",
    light: "#E9CCBA",
    highlight: "rgba(193, 139, 107, 0.22)",
  },
];

export const defaultUserColor = userColors[0];

export function getUserColor(key?: string | null) {
  return userColors.find((color) => color.key === key) ?? defaultUserColor;
}

export function stableColorKey(seed: string): UserColorKey {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return userColors[hash % userColors.length].key;
}
