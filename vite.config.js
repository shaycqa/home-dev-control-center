import { defineConfig } from "vite";
export default defineConfig({
  plugins: [
    {
      name: "local-only-fonts",
      enforce: "pre",
      transform(code, id) {
        if (id.endsWith(".css"))
          return code.replace(/@font-face\s*\{[^}]*cdn\.svar\.dev[^}]*\}/g, "");
      },
    },
  ],
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/@xterm/")) return "terminal";
          if (id.includes("/@svar-ui/")) return "filemanager";
          if (
            id.includes("/@codemirror/") ||
            id.includes("/codemirror/") ||
            id.includes("/@lezer/")
          )
            return "editor";
          if (id.includes("/react-dom/") || id.includes("/react/"))
            return "react";
        },
      },
    },
  },
});
