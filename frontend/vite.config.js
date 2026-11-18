import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development, API calls are forwarded to the Python backend on port 8765.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://127.0.0.1:8765" } },
});
