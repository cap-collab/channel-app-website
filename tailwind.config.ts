import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // Channel brand colors
        accent: {
          DEFAULT: '#D94099',
          hover: '#E54DA6',
          muted: '#D94099/20',
        },
        surface: {
          base: '#121212',
          card: '#1C1C1C',
          elevated: '#262626',
        },
      },
    },
  },
  plugins: [],
};
export default config;
