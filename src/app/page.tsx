import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { runtime } from "@/server/runtime";
import { cookieName } from "@/server/auth/auth";
import { Console } from "@/components/Console";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>;
}) {
  const { run } = await searchParams;
  const { store } = await runtime();
  if (!store.session((await cookies()).get(cookieName)?.value || ""))
    redirect(
      "/signin" +
        (run && /^[A-Za-z0-9-]{1,64}$/.test(run) ? "?run=" + run : ""),
    );
  return <Console />;
}
