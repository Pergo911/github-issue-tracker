import { Link } from "react-router";
import { useT } from "@/i18n/context.tsx";
import { buttonVariants } from "@/ui/button.tsx";

/** A link back to the home page, for pages that have nowhere else to go yet. */
export function BackToHome() {
  const t = useT();
  return (
    <Link to="/" className={buttonVariants({ variant: "secondary" })}>
      {t("nav.backToHome")}
    </Link>
  );
}
