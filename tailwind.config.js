// tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./app/**/*.{js,jsx,ts,tsx}"
  ],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: { sm: "640px", md: "768px", lg: "1024px", xl: "1280px", "2xl": "1440px" }
    },
    extend: {
      colors: {
        brand: {
          gold:  "#CBA135",
          gold2: "#E6C767",   // hover / subtle accents
          black: "#0B0C10",
          card:  "#111317",
          line:  "#1F2937",
          text:  "#E5E7EB",
          muted: "#9CA3AF"
        }
      },
      fontFamily: {
        sans: [
          "ui-sans-serif","system-ui","-apple-system","Segoe UI",
          "Roboto","Helvetica Neue","Arial","Noto Sans","sans-serif"
        ]
      },
      boxShadow: {
        card: "0 6px 30px -12px rgba(0,0,0,0.35)"
      },
      borderRadius: {
        xl: "0.75rem",
        "2xl": "1rem"
      },
      typography: ({ theme }) => ({
        DEFAULT: {
          css: {
            color: theme("colors.brand.text"),
            a: {
              color: theme("colors.brand.gold"),
              textDecoration: "underline",
              "&:hover": { color: theme("colors.brand.gold2") }
            },
            h1: { color: theme("colors.white") },
            h2: { color: theme("colors.white") },
            h3: { color: theme("colors.white") },
            strong: { color: theme("colors.white") },
            hr: { borderColor: theme("colors.brand.line") },
            code: { color: theme("colors.brand.gold") }
          }
        }
      }),
      keyframes: {
        "fade-in": { "0%": { opacity: 0 }, "100%": { opacity: 1 } }
      },
      animation: {
        "fade-in": "fade-in .25s ease-out"
      }
    }
  },
  plugins: [
    require("@tailwindcss/forms")({ strategy: "class" }), // use 'form-input', etc.
    require("@tailwindcss/typography"),
    require("@tailwindcss/aspect-ratio")
  ]
};
