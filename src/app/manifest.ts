import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Can You Find It?",
    short_name: "Find It",
    description: "A local AI picks something in the place you're standing in. You find it with your own eyes.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f2eee4",
    theme_color: "#15130f",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
