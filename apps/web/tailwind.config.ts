import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(205 22% 88%)",
        background: "hsl(200 33% 98%)",
        foreground: "hsl(207 32% 13%)",
        muted: "hsl(202 24% 95%)",
        "muted-foreground": "hsl(216 10% 42%)",
        primary: "hsl(196 79% 26%)",
        "primary-foreground": "hsl(0 0% 100%)",
        accent: "hsl(154 62% 42%)",
        danger: "hsl(0 72% 45%)"
      }
    }
  },
  plugins: []
};

export default config;
