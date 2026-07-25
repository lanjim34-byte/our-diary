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
    paperSoft: "#FFF8EF",
    light: "#EBC7A7",
    ambient: "#B9855A",
    highlight: "rgba(185, 133, 90, 0.24)",
  },
  {
    key: "moss_green",
    name: "苔绿",
    base: "#86A764",
    paper: "#F3FAE9",
    paperSoft: "#FAFCF4",
    light: "#D5E9BD",
    ambient: "#86A764",
    highlight: "rgba(134, 167, 100, 0.24)",
  },
  {
    key: "dusty_blue",
    name: "雾蓝",
    base: "#709DB9",
    paper: "#EEF8FD",
    paperSoft: "#F7FBFD",
    light: "#CBE6F4",
    ambient: "#709DB9",
    highlight: "rgba(112, 157, 185, 0.24)",
  },
  {
    key: "muted_rose",
    name: "旧粉",
    base: "#C98282",
    paper: "#FFF0F0",
    paperSoft: "#FFF7F6",
    light: "#EFC4C4",
    ambient: "#C98282",
    highlight: "rgba(201, 130, 130, 0.24)",
  },
  {
    key: "soft_ochre",
    name: "蜜黄",
    base: "#CBA24E",
    paper: "#FFF7DE",
    paperSoft: "#FFF9EA",
    light: "#F1DA9A",
    ambient: "#CBA24E",
    highlight: "rgba(203, 162, 78, 0.26)",
  },
  {
    key: "lavender_gray",
    name: "灰紫",
    base: "#9887B2",
    paper: "#F8F2FE",
    paperSoft: "#FBF7FE",
    light: "#E1D4F0",
    ambient: "#9887B2",
    highlight: "rgba(152, 135, 178, 0.24)",
  },
  {
    key: "mist_teal",
    name: "雾青",
    base: "#6EAAA0",
    paper: "#EDF9F6",
    paperSoft: "#F6FCFA",
    light: "#C6EADF",
    ambient: "#6EAAA0",
    highlight: "rgba(110, 170, 160, 0.24)",
  },
  {
    key: "clay_peach",
    name: "陶桃",
    base: "#C78463",
    paper: "#FFF0E6",
    paperSoft: "#FFF7F1",
    light: "#EDC5AF",
    ambient: "#C78463",
    highlight: "rgba(199, 132, 99, 0.24)",
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
