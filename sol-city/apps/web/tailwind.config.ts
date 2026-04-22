import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        sol: {
          purple: "#9945FF",
          green: "#14F195",
          cyan: "#00D1FF",
          dark: "#0E0E2C",
          mid: "#1A1A3E",
          gold: "#FFD700",
          orange: "#FF6B35",
          pink: "#F72585",
        },
      },
      fontFamily: {
        pixel: ['"Press Start 2P"', "monospace"],
        mono: ['"Fira Code"', "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
