"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, ImageUp, Link2, Plus, Trash2, X } from "@/components/icons";
import { apiRequest, apiUpload, ApiError } from "@/lib/api";
import type { AuthMessageResponse, SessionResponse, UserProfile, UserProfileResponse } from "@/lib/types";
import { Avatar, Notice, SaveState, SettingsCard, SettingsPageTitle } from "@/components/settings/settings-ui";
import { squareImage } from "@/lib/image";

const BIO_MAX = 160;
const NAME_MAX = 80;
const LINKS_MAX = 4;
const PRONOUN_PRESETS = ["", "they/them", "she/her", "he/him"];
const EMPTY_PROFILE: UserProfile = { bio: "", pronouns: "", website: "", timezone: "", social_links: [] };

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

function allTimeZones() {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

function zoneOffsetLabel(zone: string) {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName");
    return part?.value.replace("GMT", "UTC") ?? "";
  } catch {
    return "";
  }
}

/** PUT the whole profile with one card's fields changed, so cards never overwrite each other's unsaved edits. */
function useSaveProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<UserProfile>) => {
      const current = queryClient.getQueryData<UserProfileResponse>(["account-profile"])?.profile ?? EMPTY_PROFILE;
      const next = { ...current, ...patch };
      return apiRequest<UserProfileResponse>("/api/account/profile", {
        method: "PUT",
        body: JSON.stringify({
          bio: next.bio,
          pronouns: next.pronouns,
          website: next.website,
          timezone: next.timezone,
          social_links: next.social_links,
        }),
      });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["account-profile"], data);
    },
  });
}

// Photos are resized in the browser before upload, so the original can be large.
const AVATAR_MAX_BYTES = 20 * 1024 * 1024;
const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

function AvatarCard({ session, data, disabled }: { session?: SessionResponse; data?: UserProfileResponse; disabled: boolean }) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const uploadsEnabled = data?.avatar_uploads === true;
  const avatarUrl = data?.avatar_url || null;

  const setAvatar = (url: string) =>
    queryClient.setQueryData<UserProfileResponse>(["account-profile"], (current) => (current ? { ...current, avatar_url: url } : current));
  const upload = useMutation({
    mutationFn: async (file: File) => apiUpload<{ avatar_url: string }>("/api/account/avatar", "file", await squareImage(file)),
    onSuccess: (res) => setAvatar(res.avatar_url),
  });
  const remove = useMutation({
    mutationFn: () => apiRequest<{ avatar_url: string }>("/api/account/avatar", { method: "DELETE" }),
    onSuccess: () => setAvatar(""),
  });
  const busy = upload.isPending || remove.isPending;
  const error = clientError ?? (upload.isError ? (upload.error as ApiError).message : remove.isError ? (remove.error as ApiError).message : null);

  return (
    <SettingsCard
      id="avatar"
      title="Avatar"
      description={uploadsEnabled ? "Any photo works: it's cropped to a square and resized before it's uploaded." : "Built from your initials. This server can't store pictures."}
      hint={upload.isSuccess || remove.isSuccess || error ? <SaveState saved={upload.isSuccess ? "Avatar updated." : remove.isSuccess ? "Avatar removed." : null} error={error} /> : undefined}
      action={
        uploadsEnabled ? (
          <>
            {avatarUrl ? (
              <button type="button" className="console-btn console-btn-secondary" disabled={disabled || busy} onClick={() => remove.mutate()}>
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </button>
            ) : null}
            <button type="button" className="console-btn console-btn-primary" disabled={disabled || busy} onClick={() => fileInput.current?.click()}>
              <ImageUp className="h-3.5 w-3.5" /> {upload.isPending ? "Uploading" : avatarUrl ? "Change" : "Upload"}
            </button>
          </>
        ) : undefined
      }
    >
      <div className="flex items-center gap-4">
        <Avatar name={session?.user?.name} email={session?.user?.email} src={avatarUrl} size={64} />
        <div className="text-sm text-[var(--lp-muted)]">
          <p className="text-[var(--lp-text)]">{session?.user?.name || session?.user?.email}</p>
          <p className="text-xs text-[var(--lp-subtle)]">
            {avatarUrl ? "Visible to people in your workspaces." : "Your initials are shown until you add a picture. Signing in with Google uses your Google photo."}
          </p>
        </div>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept={AVATAR_TYPES.join(",")}
        className="hidden"
        aria-label="Avatar image"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          setClientError(null);
          upload.reset();
          remove.reset();
          if (!file) return;
          if (!AVATAR_TYPES.includes(file.type)) return setClientError("Use a PNG, JPEG, WebP, or GIF image.");
          if (file.size > AVATAR_MAX_BYTES) return setClientError("Image must be 20 MB or smaller.");
          upload.mutate(file);
        }}
      />
    </SettingsCard>
  );
}

function DisplayNameCard({ session, disabled }: { session?: SessionResponse; disabled: boolean }) {
  const queryClient = useQueryClient();
  const user = session?.user;
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? user?.name ?? "";
  const trimmed = value.trim();
  const changed = trimmed !== (user?.name ?? "");

  const save = useMutation({
    mutationFn: (name: string) =>
      apiRequest<AuthMessageResponse>("/api/auth/profile", { method: "PATCH", body: JSON.stringify({ name, email: user?.email ?? "" }) }),
    onSuccess: async (response) => {
      setDraft(null);
      if (response.user) {
        queryClient.setQueryData<SessionResponse>(["session"], (current) => ({ ...current, authenticated: true, user: response.user }));
      }
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
  });

  return (
    <SettingsCard
      id="display-name"
      title="Display name"
      description="Your name as teammates see it, and on alert and invitation emails."
      onSubmit={() => changed && trimmed && save.mutate(trimmed)}
      hint={
        <SaveState
          saved={save.isSuccess && !changed ? "Saved." : null}
          error={save.isError ? (save.error as ApiError).message : trimmed === "" && draft !== null ? "Name can't be empty." : null}
          idle={`Up to ${NAME_MAX} characters.`}
        />
      }
      action={
        <button type="submit" className="console-btn console-btn-primary" disabled={disabled || !changed || !trimmed || save.isPending}>
          {save.isPending ? "Saving" : "Save"}
        </button>
      }
    >
      <input
        aria-label="Display name"
        className="h-9 w-full max-w-sm px-3"
        maxLength={NAME_MAX}
        autoComplete="name"
        disabled={disabled || save.isPending}
        value={value}
        onChange={(e) => {
          save.reset();
          setDraft(e.target.value);
        }}
      />
    </SettingsCard>
  );
}

function AboutCard({ profile, disabled }: { profile: UserProfile; disabled: boolean }) {
  const [draft, setDraft] = useState<Pick<UserProfile, "bio" | "pronouns" | "website"> | null>(null);
  const value = draft ?? { bio: profile.bio, pronouns: profile.pronouns, website: profile.website };
  const customPronouns = !PRONOUN_PRESETS.includes(value.pronouns);
  const [pronounMode, setPronounMode] = useState<"preset" | "custom" | null>(null);
  const showCustom = pronounMode === "custom" || (pronounMode === null && customPronouns);
  const changed = value.bio !== profile.bio || value.pronouns !== profile.pronouns || value.website !== profile.website;
  const save = useSaveProfile();
  const update = (patch: Partial<typeof value>) => {
    save.reset();
    setDraft({ ...value, ...patch });
  };

  return (
    <SettingsCard
      id="about"
      title="About you"
      description="A short line about what you look after, shown on your profile in shared workspaces."
      onSubmit={() =>
        changed &&
        save.mutate({ bio: value.bio, pronouns: value.pronouns, website: value.website }, { onSuccess: () => setDraft(null) })
      }
      hint={<SaveState saved={save.isSuccess && !changed ? "Saved." : null} error={save.isError ? (save.error as ApiError).message : null} />}
      action={
        <button type="submit" className="console-btn console-btn-primary" disabled={disabled || !changed || save.isPending}>
          {save.isPending ? "Saving" : "Save"}
        </button>
      }
    >
      <div className="grid gap-4">
        <label className="block">
          <span className="mb-1.5 flex items-baseline justify-between text-xs text-[var(--lp-muted)]">
            Bio
            <span className={value.bio.length > BIO_MAX ? "text-[#ff8fb3]" : "text-[var(--lp-subtle)]"}>
              {value.bio.length}/{BIO_MAX}
            </span>
          </span>
          <textarea
            aria-label="Bio"
            rows={3}
            maxLength={BIO_MAX}
            className="w-full resize-y px-3 py-2"
            placeholder="On-call for the payments edge. Usually in Grafana."
            disabled={disabled || save.isPending}
            value={value.bio}
            onChange={(e) => update({ bio: e.target.value })}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs text-[var(--lp-muted)]">Pronouns</span>
            <select
              aria-label="Pronouns"
              className="h-9 w-full px-2"
              disabled={disabled || save.isPending}
              value={showCustom ? "custom" : value.pronouns}
              onChange={(e) => {
                if (e.target.value === "custom") {
                  setPronounMode("custom");
                  update({ pronouns: customPronouns ? value.pronouns : "" });
                } else {
                  setPronounMode("preset");
                  update({ pronouns: e.target.value });
                }
              }}
            >
              <option value="">Don&apos;t specify</option>
              <option value="they/them">they/them</option>
              <option value="she/her">she/her</option>
              <option value="he/him">he/him</option>
              <option value="custom">Custom</option>
            </select>
            {showCustom ? (
              <input
                aria-label="Custom pronouns"
                className="mt-2 h-9 w-full px-3"
                maxLength={40}
                placeholder="e.g. ze/zir"
                disabled={disabled || save.isPending}
                value={value.pronouns}
                onChange={(e) => update({ pronouns: e.target.value })}
              />
            ) : null}
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs text-[var(--lp-muted)]">Website</span>
            <span className="relative block">
              <Globe className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--lp-subtle)]" />
              <input
                aria-label="Website"
                className="h-9 w-full pl-8 pr-3"
                placeholder="example.com"
                maxLength={200}
                inputMode="url"
                disabled={disabled || save.isPending}
                value={value.website}
                onChange={(e) => update({ website: e.target.value })}
              />
            </span>
          </label>
        </div>
      </div>
    </SettingsCard>
  );
}

function SocialLinksCard({ profile, disabled }: { profile: UserProfile; disabled: boolean }) {
  const [draft, setDraft] = useState<string[] | null>(null);
  const links = draft ?? (profile.social_links.length ? profile.social_links : [""]);
  const cleaned = links.map((l) => l.trim()).filter(Boolean);
  const changed = JSON.stringify(cleaned) !== JSON.stringify(profile.social_links);
  const save = useSaveProfile();
  const set = (next: string[]) => {
    save.reset();
    setDraft(next);
  };

  return (
    <SettingsCard
      id="social"
      title="Social accounts"
      description="GitHub, LinkedIn, Mastodon, or anywhere else people can find you."
      onSubmit={() => changed && save.mutate({ social_links: cleaned }, { onSuccess: () => setDraft(null) })}
      hint={<SaveState saved={save.isSuccess && !changed ? "Saved." : null} error={save.isError ? (save.error as ApiError).message : null} idle={`Up to ${LINKS_MAX} links.`} />}
      action={
        <button type="submit" className="console-btn console-btn-primary" disabled={disabled || !changed || save.isPending}>
          {save.isPending ? "Saving" : "Save"}
        </button>
      }
    >
      <ul className="grid gap-2">
        {links.map((link, i) => (
          <li key={i} className="flex items-center gap-2">
            <Link2 className="h-4 w-4 shrink-0 text-[var(--lp-subtle)]" aria-hidden="true" />
            <input
              aria-label={`Social link ${i + 1}`}
              className="h-9 min-w-0 flex-1 px-3"
              placeholder="https://github.com/you"
              maxLength={200}
              inputMode="url"
              disabled={disabled || save.isPending}
              value={link}
              onChange={(e) => set(links.map((l, j) => (j === i ? e.target.value : l)))}
            />
            <button
              type="button"
              aria-label={`Remove social link ${i + 1}`}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-[var(--lp-subtle)] hover:bg-white/[0.05] hover:text-[var(--lp-text)] disabled:opacity-40"
              disabled={disabled || (links.length === 1 && !link)}
              onClick={() => set(links.length === 1 ? [""] : links.filter((_, j) => j !== i))}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      {links.length < LINKS_MAX ? (
        <button
          type="button"
          className="mt-0.5 inline-flex items-center gap-1.5 py-1.5 text-sm text-[var(--lp-muted)] hover:text-[var(--lp-text)] disabled:opacity-40"
          disabled={disabled}
          onClick={() => set([...links, ""])}
        >
          <Plus className="h-3.5 w-3.5" /> Add link
        </button>
      ) : null}
    </SettingsCard>
  );
}

function TimezoneCard({ profile, disabled }: { profile: UserProfile; disabled: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? profile.timezone;
  const changed = value !== profile.timezone;
  const save = useSaveProfile();
  const zones = useMemo(() => allTimeZones(), []);
  const browserZone = useMemo(() => browserTimeZone(), []);
  const effective = value || browserZone;

  return (
    <SettingsCard
      id="timezone"
      title="Timezone"
      description="Alert emails, reports, and charts show times in this zone."
      onSubmit={() => changed && save.mutate({ timezone: value }, { onSuccess: () => setDraft(null) })}
      hint={
        <SaveState
          saved={save.isSuccess && !changed ? "Saved." : null}
          error={save.isError ? (save.error as ApiError).message : null}
          idle={`Now ${new Date().toLocaleTimeString([], { timeZone: effective, hour: "2-digit", minute: "2-digit" })} in ${effective}.`}
        />
      }
      action={
        <button type="submit" className="console-btn console-btn-primary" disabled={disabled || !changed || save.isPending}>
          {save.isPending ? "Saving" : "Save"}
        </button>
      }
    >
      <select
        aria-label="Timezone"
        className="h-9 w-full max-w-sm px-2"
        disabled={disabled || save.isPending}
        value={value}
        onChange={(e) => {
          save.reset();
          setDraft(e.target.value);
        }}
      >
        <option value="">Use my browser&apos;s timezone ({browserZone})</option>
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone.replace(/_/g, " ")} ({zoneOffsetLabel(zone)})
          </option>
        ))}
      </select>
    </SettingsCard>
  );
}

export function ProfileSettings() {
  const sessionQuery = useQuery({ queryKey: ["session"], queryFn: () => apiRequest<SessionResponse>("/api/auth/session") });
  const profileQuery = useQuery({
    queryKey: ["account-profile"],
    queryFn: () => apiRequest<UserProfileResponse>("/api/account/profile"),
    enabled: sessionQuery.data?.authenticated === true,
  });
  const session = sessionQuery.data;
  const isDemo = session?.mode === "demo";
  const profile = profileQuery.data?.profile;

  return (
    <div className="grid grid-cols-1 gap-5">
      <SettingsPageTitle title="Public profile" description="How you appear to teammates across Qnetward workspaces." />

      {isDemo ? <Notice tone="info">This is the shared demo account, so profile changes are turned off.</Notice> : null}

      <AvatarCard session={session} data={profileQuery.data} disabled={isDemo} />

      <DisplayNameCard session={session} disabled={isDemo} />

      {profileQuery.isError ? (
        <Notice tone="error">{(profileQuery.error as ApiError).message || "Couldn't load your profile."}</Notice>
      ) : !profile ? (
        <p className="text-sm text-[var(--lp-subtle)]">Loading profile…</p>
      ) : (
        // Each card keeps its own draft over the saved profile, so saving one leaves the others' edits alone.
        <div className="grid grid-cols-1 gap-5">
          <AboutCard profile={profile} disabled={isDemo} />
          <SocialLinksCard profile={profile} disabled={isDemo} />
          <TimezoneCard profile={profile} disabled={isDemo} />
        </div>
      )}
    </div>
  );
}
