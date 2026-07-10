import { Cloud, CloudLightning, Snowflake, Sun, Umbrella, Wind, type LucideIcon } from "lucide-react";

export type WeatherKey = "sunny" | "cloudy" | "rainy" | "windy" | "snowy" | "thunder";

export type WeatherOption = {
  key: WeatherKey;
  label: string;
  icon: LucideIcon;
};

export const weatherOptions: WeatherOption[] = [
  { key: "sunny", label: "晴", icon: Sun },
  { key: "cloudy", label: "云", icon: Cloud },
  { key: "rainy", label: "雨", icon: Umbrella },
  { key: "windy", label: "风", icon: Wind },
  { key: "snowy", label: "雪", icon: Snowflake },
  { key: "thunder", label: "雷", icon: CloudLightning },
];

export function getWeatherOption(value?: string | null) {
  const aliases: Record<string, WeatherKey> = {
    晴: "sunny",
    多云: "cloudy",
    云: "cloudy",
    下雨: "rainy",
    雨: "rainy",
    大风: "windy",
    风: "windy",
    雪: "snowy",
    雷: "thunder",
  };
  const key = value && value in aliases ? aliases[value] : value;
  return weatherOptions.find((option) => option.key === key) ?? null;
}
