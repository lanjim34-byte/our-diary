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
  paperSoft: string;
  light: string;
  ambient: string;
  highlight: string;
};

export const userColors: UserColor[] = [
  {
    key: "warm_brown",
    name: "暖栗",
    base: "#B9855A",
    paper: "#FFF4E7",
    paperSoft: "#FCF7EF",
    light: "#E8D0B8",
    ambient: "#B9855A",
    highlight: "rgba(185, 133, 90, 0.20)",
  },
  {
    key: "moss_green",
    name: "苔绿",
    base: "#8DA36B",
    paper: "#F4F8EC",
    paperSoft: "#F8FAF3",
    light: "#DCE7C9",
    ambient: "#8DA36B",
    highlight: "rgba(141, 163, 107, 0.20)",
  },
  {
    key: "dusty_blue",
    name: "雾蓝",
    base: "#7D9DB5",
    paper: "#F2F8FB",
    paperSoft: "#F7FAFB",
    light: "#D5E5EE",
    ambient: "#7D9DB5",
    highlight: "rgba(125, 157, 181, 0.20)",
  },
  {
    key: "muted_rose",
    name: "旧粉",
    base: "#C48A8A",
    paper: "#FFF3F3",
    paperSoft: "#FCF6F5",
    light: "#EBCFCF",
    ambient: "#C48A8A",
    highlight: "rgba(196, 138, 138, 0.20)",
  },
  {
    key: "soft_ochre",
    name: "蜜黄",
    base: "#C5A15A",
    paper: "#FFF8E8",
    paperSoft: "#FCF8EF",
    light: "#EEDFAF",
    ambient: "#C5A15A",
    highlight: "rgba(197, 161, 90, 0.20)",
  },
  {
    key: "lavender_gray",
    name: "灰紫",
    base: "#9A8DAE",
    paper: "#F8F4FC",
    paperSoft: "#FAF7FC",
    light: "#E1D9EC",
    ambient: "#9A8DAE",
    highlight: "rgba(154, 141, 174, 0.20)",
  },
  {
    key: "mist_teal",
    name: "雾青",
    base: "#78A39A",
    paper: "#F1F8F6",
    paperSoft: "#F6FAF8",
    light: "#CFE5E0",
    ambient: "#78A39A",
    highlight: "rgba(120, 163, 154, 0.20)",
  },
  {
    key: "clay_peach",
    name: "陶桃",
    base: "#C18B6B",
    paper: "#FFF2EA",
    paperSoft: "#FCF6F1",
    light: "#E9CCBA",
    ambient: "#C18B6B",
    highlight: "rgba(193, 139, 107, 0.20)",
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
