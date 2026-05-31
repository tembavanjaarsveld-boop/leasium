import { redirect } from "next/navigation";

export default function PeopleTenantsRedirect() {
  redirect("/people?tab=tenants");
}
