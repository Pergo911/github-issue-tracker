import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import { AppScreenshot } from "./AppScreenshot";
import "./custom.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("AppScreenshot", AppScreenshot);
  },
} satisfies Theme;
