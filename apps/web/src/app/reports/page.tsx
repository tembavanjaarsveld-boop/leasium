import { redirect } from "next/navigation";

export default function LegacyInsightsRedirectPage() {
  redirect("/insights");
}
