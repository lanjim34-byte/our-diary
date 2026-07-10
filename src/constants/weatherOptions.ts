import { Cloud, Sun, Umbrella, Wind, type LucideIcon } from "lucide-react";

export type WeatherKey = "sunny" | "cloudy" | "rainy" | "windy";

export type WeatherOption = {
  key: WeatherKey;
  label: string;
  icon: LucideIcon;
};

export const weatherOptions: WeatherOption[] = [
  { key: "sunny", label: "晴", icon: Sun },
  { key: "cloudy", label: "多云", icon: Cloud },
  { key: "rainy", label: "下雨", icon: Umbrella },
  { key: "windy", label: "大风", icon: Wind },
];

export function getWeatherOption(value?: string | null) {
  return weatherOptions.find((option) => option.key === value) ?? null;
}
