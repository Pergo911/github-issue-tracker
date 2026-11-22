import { defineComponent, h } from "vue";
import { withBase } from "vitepress";

export const AppScreenshot = defineComponent({
  name: "AppScreenshot",
  props: {
    name: { type: String, required: true },
    alt: { type: String, required: true },
    caption: { type: String, default: "" },
    eager: { type: Boolean, default: false },
  },
  setup(props) {
    return () => {
      const loading = props.eager ? "eager" : "lazy";
      const children = [
        h("div", { class: "app-screenshot-frame" }, [
          h("img", {
            class: "app-screenshot-img app-screenshot-light",
            src: withBase(`/screenshots/${props.name}--light.png`),
            alt: props.alt,
            loading,
            decoding: "async",
          }),
          h("img", {
            class: "app-screenshot-img app-screenshot-dark",
            src: withBase(`/screenshots/${props.name}--dark.png`),
            alt: props.alt,
            loading,
            decoding: "async",
          }),
        ]),
      ];

      if (props.caption) {
        children.push(h("figcaption", { class: "app-screenshot-caption" }, props.caption));
      }

      return h("figure", { class: "app-screenshot" }, children);
    };
  },
});
