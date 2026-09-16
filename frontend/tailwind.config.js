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
          50: "#eef5fd",
          100: "#d7e7fa",
          200: "#b0cff4",
          300: "#7fb0ea",
          400: "#478ed8",
          500: "#1f74c8",
          600: "#1668c1",
          700: "#12559f",
          800: "#0e447f",
          900: "#0b3462",
          950: "#072341",
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
