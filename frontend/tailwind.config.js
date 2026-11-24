/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      colors: {
        // Blue carries structure and actions; orange carries brand and attention.
        // Both anchors come from the original flow diagram.
        brand: {
          50: "rgb(var(--brand-50) / <alpha-value>)",
          100: "rgb(var(--brand-100) / <alpha-value>)",
          200: "rgb(var(--brand-200) / <alpha-value>)",
          300: "rgb(var(--brand-300) / <alpha-value>)",
          400: "rgb(var(--brand-400) / <alpha-value>)",
          500: "rgb(var(--brand-500) / <alpha-value>)",
          600: "rgb(var(--brand-600) / <alpha-value>)",
          700: "rgb(var(--brand-700) / <alpha-value>)",
          800: "rgb(var(--brand-800) / <alpha-value>)",
          900: "rgb(var(--brand-900) / <alpha-value>)",
          950: "rgb(var(--brand-950) / <alpha-value>)",
        },
        accent: {
          50: "#fdf2ec",
          100: "#fbdfd0",
          200: "#f6bda2",
          300: "#f09668",
          400: "#e8712f",
          500: "#d95a15",
          600: "#c1440e",
          700: "#a1380c",
          800: "#7f2d0b",
          900: "#5e220a",
        },
        // Role identity: the two teams in the bright tones, the two heads in the deep
        // tones, so all four stay on-theme and still tell apart.
        wetlab: { DEFAULT: "#c1440e", soft: "#fdeee6" },
        primaryteam: { DEFAULT: "#1668c1", soft: "#e7f1fd" },
        phead: { DEFAULT: "#0b3462", soft: "#e2eaf4" },
        bhead: { DEFAULT: "#8a3a12", soft: "#f7ebe3" },
      },
    },
  },
  plugins: [],
};
