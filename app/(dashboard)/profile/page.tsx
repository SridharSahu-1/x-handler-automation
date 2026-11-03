import { Suspense } from "react";
import { connection } from "next/server";
import { Card, PageTitle, Skeleton, Empty, Badge } from "@/components/ui";
import { ProfileButtons } from "@/components/small-actions";
import { profileHistory, PROFILE_EDIT_URL } from "@/lib/actions/profile";
import { canEditProfile } from "@/lib/publisher";

export default function Page() {
  return (
    <>
      <PageTitle sub="Proposals are grounded in your interview. For a profile pic, send /dp in Telegram, then photos of you. Changes are capped at once a month per field (forcing is allowed here).">Profile</PageTitle>
      <div className="mb-4"><ProfileButtons /></div>
      <Suspense fallback={<Skeleton />}>
        <Body />
      </Suspense>
    </>
  );
}

async function Body() {
  await connection();
  const rows = await profileHistory();
  if (!rows.length) return <Empty>No proposals yet.</Empty>;
  const fields = ["name", "bio", "location", "avatar", "banner", "url"];
  const auto = canEditProfile();
  return (
    <div className="space-y-4">
      {!auto && (
        <p className="text-sm text-muted">
          Free mode: only the paid X API can edit profiles, so pick an option here, then paste it in at{" "}
          <a className="underline" href={PROFILE_EDIT_URL} target="_blank" rel="noreferrer">x.com/settings/profile</a>. Images: right-click → save, then upload.
        </p>
      )}
      {fields.map((f) => {
        const rs = rows.filter((r) => r.field === f);
        if (!rs.length) return null;
        return (
          <Card key={f} title={f}>
            <ul className="space-y-3">
              {rs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 text-sm">
                  {f === "avatar" || f === "banner" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.value} alt="" className={f === "avatar" ? "h-20 w-20 rounded-full" : "h-20 rounded-md"} />
                  ) : (
                    <span className="min-w-0 flex-1 select-all">{r.value}</span>
                  )}
                  <Badge tone={r.status === "applied" ? "posted" : r.status === "proposed" ? "pending" : undefined}>{r.status}</Badge>
                  {r.status === "proposed" && <ProfileButtons id={r.id} auto={auto} />}
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}
