import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Речоград — српска игра речи",
    short_name: "Речоград",
    description: "Стратешка игра речи на српском језику.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3efe4",
    theme_color: "#17251e",
    lang: "sr-Cyrl",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
