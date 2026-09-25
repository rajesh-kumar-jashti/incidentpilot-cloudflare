/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      colors: {
        // Cloudflare-inspired dark palette
        bg: {
          DEFAULT: "#0a0a0b",
          secondary: "#111113",
          tertiary: "#18181b",
          card: "#1c1c1f",
          hover: "#232326",
        },
        border: {
          DEFAULT: "#2a2a2d",
          strong: "#3a3a3d",
        },
        text: {
          primary: "#f4f4f5",
          secondary: "#a1a1aa",
          muted: "#71717a",
          inverse: "#09090b",
        },
        brand: {
          DEFAULT: "#f6821f",
          dim: "#c26514",
          bright: "#ff9a3c",
        },
        severity: {
          critical: "#ef4444",
          high: "#f97316",
          medium: "#eab308",
          low: "#22c55e",
        },
        status: {
          investigating: "#3b82f6",
          waiting: "#a855f7",
          remediating: "#f59e0b",
          resolved: "#22c55e",
          failed: "#ef4444",
          rejected: "#6b7280",
        },
        step: {
          pending: "#3a3a3d",
          running: "#3b82f6",
          completed: "#22c55e",
          failed: "#ef4444",
        },
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "spin-slow": "spin 3s linear infinite",
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
