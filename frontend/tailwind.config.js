/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Brand
        primary: {
          DEFAULT: "#0B617E",
          dark: "#09506a",
          shadow: "#04303f",
          soft: "#EBF4F8",
          tint: "#CEDFE5",
        },
        // Surfaces (backgrounds that stack on each other)
        surface: {
          DEFAULT: "#ffffff",
          muted: "#f5f7f9",
          subtle: "#f8fafc",
          soft: "#f8fafb",
          alt: "#f9fafb",
          raised: "#f1f5f9",
        },
        // Borders
        line: {
          DEFAULT: "#e8eef2",
          neutral: "#e2e8f0",
          muted: "#d1d5db",
          faint: "#f1f5f9",
          soft: "#edf1f5",
          divider: "#e5e7eb",
        },
        // Text
        ink: {
          DEFAULT: "#0f172a",
          strong: "#111827",
          body: "#334155",
          muted: "#475569",
          subtle: "#64748b",
          dim: "#94a3b8",
          faint: "#9ca3af",
          soft: "#b0bec5",
          inverse: "#ffffff",
        },
        // Semantic
        success: {
          DEFAULT: "#059669",
          bg: "#ecfdf5",
          text: "#065f57",
        },
        danger: {
          DEFAULT: "#dc2626",
          strong: "#b91c1c",
          soft: "#ef4444",
          bg: "#fee2e2",
          bgSoft: "#fef2f2",
          bgAlt: "#fff1f2",
          border: "#fecaca",
          borderAlt: "#fecdd3",
        },
        warn: {
          text: "#92400e",
          bg: "#fef3c7",
        },
        // Warm secondary (sand) — quiet warm accent paired with teal primary
        secondary: {
          DEFAULT: "#C08A5E",
          deep: "#9F6E45",
          soft: "rgba(192, 138, 94, 0.10)",
          ring: "rgba(192, 138, 94, 0.22)",
        },
        // Vibrant per-group avatar tile accents (used for default no-pfp tiles)
        accent: {
          teal:  "#0B617E",
          aqua:  "#2A8AA5",
          sand:  "#C08A5E",
          amber: "#D89E3A",
          coral: "#D26A4A",
          rose:  "#C95F76",
          plum:  "#8B5470",
          olive: "#7A8740",
        },
        // Warm app background (matches design theme.bg / bgSoft)
        canvas: {
          DEFAULT: "#F7F6F2",
          soft: "#EFEDE6",
        },
      },
      borderRadius: {
        sheet: "28px",
        card: "14px",
      },
      fontSize: {
        // Page titles used across top banners
        display: ["40px", { lineHeight: "44px", fontWeight: "800", letterSpacing: "-1px" }],
      },
      boxShadow: {
        card: "0px 1px 6px rgba(15, 23, 42, 0.04)",
        banner: "0px 6px 10px rgba(4, 48, 63, 0.15)",
        brand: "0px 2px 14px rgba(11, 97, 126, 0.07)",
      },
    },
  },
  plugins: [],
};
