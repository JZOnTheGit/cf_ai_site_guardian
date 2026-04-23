// tailwind config, just extends the default theme a bit
/** @type {import('tailwindcss').Config} */
export default {
  // scan these files for class names
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // use inter font first, fall back to system fonts
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Display",
          "system-ui",
          "sans-serif",
        ],
      },
      // custom neutral + accent palette for the apple-style look
      colors: {
        ink: {
          50: "#f7f7f8",
          100: "#eeeef0",
          200: "#d9d9de",
          300: "#b8b8c0",
          400: "#8e8e98",
          500: "#6b6b75",
          600: "#4b4b54",
          700: "#35353c",
          800: "#1f1f24",
          900: "#111114",
        },
        accent: {
          50: "#eef6ff",
          100: "#d9eaff",
          500: "#0a84ff",
          600: "#0070e0",
          700: "#0059b3",
        },
      },
      // soft shadows for the card look
      boxShadow: {
        card: "0 1px 2px rgba(17, 17, 20, 0.04), 0 8px 24px rgba(17, 17, 20, 0.06)",
        soft: "0 1px 2px rgba(17, 17, 20, 0.04), 0 2px 8px rgba(17, 17, 20, 0.04)",
      },
      borderRadius: {
        xl2: "1.25rem",
      },
    },
  },
  plugins: [],
};
