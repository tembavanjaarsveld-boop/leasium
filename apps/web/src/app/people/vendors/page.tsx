import { redirect } from "next/navigation";

export default function PeopleVendorsRedirect() {
  redirect("/people?tab=vendors");
}
