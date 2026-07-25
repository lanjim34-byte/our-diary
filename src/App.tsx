import {
  CalendarDays,
  Check,
  Droplet,
  HandHeart,
  Heart,
  HeartHandshake,
  Home,
  Image,
  MessageCircle,
  PenLine,
  Plus,
  Sparkles,
  Star,
  UserRound,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { hasSupabaseEnv, supabase } from "./supabaseClient";
import { defaultUserColor, getUserColor, stableColorKey, userColors, type UserColorKey } from "./constants/userColors";
import { getWeatherOption, weatherOptions, type WeatherKey } from "./constants/weatherOptions";
import { getMoodToneOption, moodToneFromValue, moodToneOptions, type MoodTone } from "./constants/moodTemperature";

type Status = "开心" | "普通" | "有点累" | "卡住了" | "想聊天" | "需要安静";
type Tab = "feed" | "write" | "friends" | "week";
type Composer = "stamp" | "note" | "follow" | null;

type Profile = {
  id: string;
  display_name: string;
  avatar_initial: string;
  color_key: string | null;
};

type Notebook = {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
  created_at: string;
};

type Member = {
  user_id: string;
  role: "owner" | "member";
  profile: Profile;
};

type Diary = {
  id: string;
  authorId: string;
  text: string;
  status?: Status | null;
  moodTone?: MoodTone | null;
  moodWords: string[];
  diaryDate: string;
  weather?: string | null;
  doodleUrl?: string | null;
  responses: { by: string; text: string; colorKey?: string | null; authorId?: string; createdAt?: string }[];
  comments: { by: string; text: string; time: string; colorKey?: string | null; authorId?: string; createdAt?: string }[];
  followUps: { by: string; text: string; time: string; authorId?: string; createdAt?: string }[];
  highlights: HighlightRange[];
  createdAt: string;
};

type HighlightRange = {
  id: string;
  start: number;
  end: number;
  colorKey?: string | null;
};

type HighlightBubble = {
  start: number;
  end: number;
  x: number;
  y: number;
} | null;

type NotebookMembership = {
  notebook: Notebook;
  role: "owner" | "member";
};

type SavedDoodle = {
  id: string;
  imageUrl: string;
  createdAt: string;
};

const statusOptions: Status[] = ["开心", "普通", "有点累", "卡住了", "想聊天", "需要安静"];
const promptOptions = ["碎碎念", "奇思", "我跟你讲哦…", "说不清", "想被听见"];
const tornPageMarker = "__OUR_DIARY_TORN_PAGE__";
const stampOptions = [
  { name: "爱心", hint: "关心", icon: Heart },
  { name: "星星", hint: "鼓励", icon: Star },
  { name: "水滴", hint: "心疼", icon: Droplet },
  { name: "拥抱", hint: "陪伴", icon: HandHeart },
  { name: "读到了", hint: "我读到了", icon: Check },
];

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberships, setMemberships] = useState<NotebookMembership[]>([]);
  const [activeNotebook, setActiveNotebook] = useState<Notebook | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [diaries, setDiaries] = useState<Diary[]>([]);
  const [tab, setTab] = useState<Tab>("feed");
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [openDiaryId, setOpenDiaryId] = useState<string | null>(null);
  const [doodlePreview, setDoodlePreview] = useState<string | null>(null);
  const [avatarDoodles, setAvatarDoodles] = useState<Record<string, string>>({});
  const [avatarEditor, setAvatarEditor] = useState<Member | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAvatarDoodles(loadLocalAvatarDoodles());
  }, []);

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const loadNotebooks = useCallback(async (user: User) => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    try {
      const nextProfile = await ensureProfile(user);
      setProfile(nextProfile);

      const { data, error: membershipsError } = await supabase
        .from("notebook_members")
        .select("role, notebooks(id,name,invite_code,created_by,created_at)")
        .eq("user_id", user.id)
        .order("joined_at", { ascending: false });

      if (membershipsError) throw membershipsError;

      const nextMemberships = ((data ?? []) as any[])
        .filter((item) => item.notebooks)
        .map((item) => ({
          role: item.role,
          notebook: item.notebooks as Notebook,
        }));

      setMemberships(nextMemberships);
      setActiveNotebook((current) => {
        if (current && nextMemberships.some((membership) => membership.notebook.id === current.id)) return current;
        return nextMemberships.length === 1 ? nextMemberships[0].notebook : null;
      });
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadNotebookData = useCallback(async (notebook: Notebook) => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    try {
      const { data: memberRows, error: membersError } = await supabase
        .from("notebook_members")
        .select("user_id, role, profiles(id,display_name,avatar_initial,color_key)")
        .eq("notebook_id", notebook.id)
        .order("joined_at", { ascending: true });
      if (membersError) throw membersError;

      const nextMembers: Member[] = ((memberRows ?? []) as any[]).map((row) => ({
        user_id: row.user_id,
        role: row.role,
        profile: row.profiles ?? fallbackProfile(row.user_id),
      }));
      setMembers(nextMembers);
      setSelectedPersonId((current) => current ?? nextMembers[0]?.user_id ?? null);

      const { data: entryRows, error: entriesError } = await supabase
        .from("diary_entries")
        .select("id,notebook_id,author_id,content,mood,mood_tone,mood_words,diary_date,weather,doodle_url,created_at,updated_at")
        .eq("notebook_id", notebook.id)
        .order("diary_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (entriesError) throw entriesError;

      const entries = entryRows ?? [];
      const ids = entries.map((entry) => entry.id);
      const [followups, paperNotes, stamps, highlights] = await Promise.all([
        fetchByDiaryIds("diary_followups", ids),
        fetchByDiaryIds("paper_notes", ids),
        fetchByDiaryIds("stamps", ids),
        fetchByDiaryIds("highlights", ids),
      ]);

      const profilesById = new Map(nextMembers.map((member) => [member.user_id, member.profile]));
      const nextDiaries: Diary[] = entries.map((entry: any) => ({
        id: entry.id,
        authorId: entry.author_id,
        text: entry.content,
        status: isStatus(entry.mood) ? entry.mood : null,
        moodTone: getMoodToneOption(entry.mood_tone)?.key ?? null,
        moodWords: parseMoodWords(entry.mood_words),
        diaryDate: entry.diary_date || localDateKey(new Date(entry.created_at)),
        weather: entry.weather,
        doodleUrl: entry.doodle_url ?? null,
        createdAt: entry.created_at,
        responses: stamps
          .filter((stamp: any) => stamp.diary_id === entry.id)
          .map((stamp: any) => ({
            by: profilesById.get(stamp.author_id)?.display_name ?? "朋友",
            text: stamp.stamp_type,
            colorKey: profilesById.get(stamp.author_id)?.color_key,
            authorId: stamp.author_id,
            createdAt: stamp.created_at,
          })),
        comments: paperNotes
          .filter((note: any) => note.diary_id === entry.id)
          .map((note: any) => ({
            by: profilesById.get(note.author_id)?.display_name ?? "朋友",
            text: note.content,
            time: formatNoteTime(note.created_at),
            colorKey: profilesById.get(note.author_id)?.color_key,
            authorId: note.author_id,
            createdAt: note.created_at,
          })),
        followUps: followups
          .filter((followup: any) => followup.diary_id === entry.id)
          .map((followup: any) => ({
            by: profilesById.get(followup.author_id)?.display_name ?? "朋友",
            text: followup.content,
            time: formatNoteTime(followup.created_at),
            authorId: followup.author_id,
            createdAt: followup.created_at,
          })),
        highlights: highlights
          .filter((highlight: any) => highlight.diary_id === entry.id)
          .map((highlight: any) => ({ id: highlight.id, start: highlight.start_index, end: highlight.end_index, colorKey: profilesById.get(highlight.author_id)?.color_key })),
      })).sort(compareDiaries);

      setDiaries(nextDiaries);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session?.user) {
      loadNotebooks(session.user);
    } else {
      setProfile(null);
      setMemberships([]);
      setActiveNotebook(null);
      setMembers([]);
      setDiaries([]);
      setSelectedPersonId(null);
    }
  }, [session, loadNotebooks]);

  useEffect(() => {
    if (activeNotebook) {
      loadNotebookData(activeNotebook);
    }
  }, [activeNotebook, loadNotebookData]);

  async function createNotebook(name: string) {
    if (!supabase || !session?.user) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("create_notebook", { p_name: name || "我们的小本子" });
      if (rpcError) throw rpcError;
      await loadNotebooks(session.user);
      setActiveNotebook(data as Notebook);
    } catch (createError) {
      setError(errorMessage(createError));
    } finally {
      setLoading(false);
    }
  }

  async function joinNotebook(code: string) {
    if (!supabase || !session?.user) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("join_notebook_by_code", { p_invite_code: code });
      if (rpcError) throw rpcError;
      await loadNotebooks(session.user);
      setActiveNotebook(data as Notebook);
    } catch (joinError) {
      setError(errorMessage(joinError));
    } finally {
      setLoading(false);
    }
  }

  async function addDiary(text: string, mood: Status | null, diaryDate: string, weather: WeatherKey | null, moodTone: MoodTone | null, moodWords: string[], doodleUrl: string | null) {
    if (!supabase || !activeNotebook || !session?.user) return;
    const { error: insertError } = await supabase.from("diary_entries").insert({
      notebook_id: activeNotebook.id,
      author_id: session.user.id,
      content: text,
      mood,
      mood_tone: moodTone,
      mood_words: moodWords.length ? moodWords : null,
      diary_date: diaryDate,
      weather,
      doodle_url: doodleUrl,
    });
    if (insertError) {
      setError(errorMessage(insertError));
      throw insertError;
    }
    setTab("feed");
    await loadNotebookData(activeNotebook);
  }

  async function deleteDiary(diaryId: string) {
    if (!supabase || !session?.user) return;
    const { error: updateError } = await supabase
      .from("diary_entries")
      .update({ content: tornPageMarker })
      .eq("id", diaryId)
      .eq("author_id", session.user.id);
    if (updateError) {
      setError(errorMessage(updateError));
      throw updateError;
    }
    setDiaries((current) =>
      current.map((diary) => (diary.id === diaryId ? { ...diary, text: tornPageMarker } : diary))
    );
  }

  async function uploadDoodleImage(dataUrl: string) {
    if (!supabase || !session?.user) throw new Error("还没登录，不能保存涂鸦");
    const blob = dataUrlToBlob(dataUrl);
    const path = `${session.user.id}/${Date.now()}.png`;
    const { error: uploadError } = await supabase.storage.from("doodles").upload(path, blob, {
      contentType: "image/png",
      upsert: false,
    });
    if (uploadError) throw uploadError;
    const { data } = supabase.storage.from("doodles").getPublicUrl(path);
    return data.publicUrl;
  }

  async function saveDoodleToApp(dataUrl: string) {
    if (!supabase || !activeNotebook || !session?.user) throw new Error("还没进入小本子，不能保存涂鸦");
    const imageUrl = await uploadDoodleImage(dataUrl);
    const { error: insertError } = await supabase.from("doodles").insert({
      user_id: session.user.id,
      notebook_id: activeNotebook.id,
      image_url: imageUrl,
    });
    if (insertError) throw insertError;
    return imageUrl;
  }

  async function loadMyDoodles() {
    if (!supabase || !session?.user) return [];
    const { data, error: doodlesError } = await supabase
      .from("doodles")
      .select("id,image_url,created_at")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(18);
    if (doodlesError) throw doodlesError;
    return (data ?? []).map((item: any) => ({
      id: item.id,
      imageUrl: item.image_url,
      createdAt: item.created_at,
    })) as SavedDoodle[];
  }

  async function addFollowUp(diaryId: string, text: string) {
    if (!supabase || !activeNotebook || !session?.user) return;
    const { error: insertError } = await supabase.from("diary_followups").insert({
      diary_id: diaryId,
      author_id: session.user.id,
      content: text,
    });
    if (insertError) setError(errorMessage(insertError));
    await loadNotebookData(activeNotebook);
  }

  async function addPaperNote(diaryId: string, text: string) {
    if (!supabase || !activeNotebook || !session?.user) return;
    const { error: insertError } = await supabase.from("paper_notes").insert({
      diary_id: diaryId,
      author_id: session.user.id,
      content: text,
    });
    if (insertError) setError(errorMessage(insertError));
    await loadNotebookData(activeNotebook);
  }

  async function addStamp(diaryId: string, stampType: string) {
    if (!supabase || !activeNotebook || !session?.user) return;
    const { error: insertError } = await supabase.from("stamps").insert({
      diary_id: diaryId,
      author_id: session.user.id,
      stamp_type: stampType,
    });
    if (insertError) setError(errorMessage(insertError));
    await loadNotebookData(activeNotebook);
  }

  async function addHighlight(diaryId: string, start: number, end: number) {
    if (!supabase || !activeNotebook || !session?.user) return;
    const diary = diaries.find((item) => item.id === diaryId);
    const merged = mergeHighlights(diary?.highlights ?? [], { id: `h${Date.now()}`, start, end, colorKey: profile?.color_key });
    setDiaries((items) => items.map((item) => (item.id === diaryId ? { ...item, highlights: merged } : item)));

    const { error: insertError } = await supabase.from("highlights").insert({
      diary_id: diaryId,
      author_id: session.user.id,
      start_index: start,
      end_index: end,
    });
    if (insertError) setError(errorMessage(insertError));
    await loadNotebookData(activeNotebook);
  }

  if (!hasSupabaseEnv || !supabase) {
    return <SetupMissing />;
  }

  if (authLoading) {
    return <ShellMessage title="正在翻开小本子" text="稍等一下。" />;
  }

  if (!session) {
    return <AuthPage />;
  }

  const client = supabase;

  if (profile && !profile.color_key) {
    return (
      <ColorSetupPage
        profile={profile}
        onSaved={(nextProfile) => {
          setProfile(nextProfile);
          setMembers((current) =>
            current.map((member) =>
              member.user_id === nextProfile.id ? { ...member, profile: nextProfile } : member
            )
          );
        }}
      />
    );
  }

  if (!activeNotebook) {
    return (
      <NotebookEntryPage
        loading={loading}
        error={error}
        memberships={memberships}
        onCreate={createNotebook}
        onJoin={joinNotebook}
        onSelect={setActiveNotebook}
        onSignOut={() => client.auth.signOut()}
      />
    );
  }

  const sortedMembers = sortMembersByActivity(members, diaries);
  const selectedMember = sortedMembers.find((member) => member.user_id === selectedPersonId) ?? sortedMembers[0] ?? null;
  const selectedMemberDiaries = selectedMember ? diaries.filter((diary) => diary.authorId === selectedMember.user_id) : [];
  const groupedDiaries = groupDiaries(diaries);

  function copyInviteCode() {
    if (!activeNotebook) return;
    navigator.clipboard?.writeText(activeNotebook.invite_code);
    setInviteCopied(true);
    window.setTimeout(() => setInviteCopied(false), 1600);
  }

  function saveAvatarDoodle(userId: string, imageUrl: string | null) {
    setAvatarDoodles((current) => {
      const next = { ...current };
      if (imageUrl) {
        next[userId] = imageUrl;
      } else {
        delete next[userId];
      }
      saveLocalAvatarDoodles(next);
      return next;
    });
  }

  return (
    <div className="app" style={notebookBackgroundStyle(members)}>
      <main className="phone-shell">
        <header className="topbar">
          <div>
            <h1>{activeNotebook.name}</h1>
          </div>
          <button className="soft-icon" onClick={() => setTab("write")} aria-label="写一笔">
            <PenLine size={20} />
          </button>
        </header>

        {error && <p className="error-note">{error}</p>}

        {tab === "feed" && (
          <section className="notebook-home">
            <div className="member-strip">
              {sortedMembers.map((member, index) => (
                <button
                  key={member.user_id}
                  className="member-pill"
                  style={{ ...personStyle(member.profile), "--member-tilt": `${index % 2 === 0 ? -0.5 : 0.7}deg` } as React.CSSProperties}
                  onClick={() => {
                    setSelectedPersonId(member.user_id);
                    setTab("friends");
                  }}
                >
                  <span
                    className="avatar-edit-hit"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (member.user_id === session.user.id) {
                        setAvatarEditor(member);
                      } else {
                        setSelectedPersonId(member.user_id);
                        setTab("friends");
                      }
                    }}
                  >
                    <AvatarSticker profile={member.profile} imageUrl={avatarDoodles[member.user_id]} />
                  </span>
                  <span>
                    <strong>{member.profile.display_name}</strong>
                    <small>{memberTraceSummary(member, diaries)}</small>
                  </span>
                </button>
              ))}
            </div>
            <div className="notebook-tools">
              <button className="invite-toggle" onClick={() => setInviteOpen((value) => !value)}>
                <Sparkles size={15} />
                邀请朋友
              </button>
              {inviteOpen && (
                <div className="invite-popover">
                  <span>邀请码：{activeNotebook.invite_code}</span>
                  <button onClick={copyInviteCode}>{inviteCopied ? "已复制" : "复制"}</button>
                </div>
              )}
            </div>

            {loading && <EmptyState title="正在翻页" text="把这本子的内容取回来。" />}
            {!loading && diaries.length === 0 && <EmptyState title="这本子还空着" text="先写一句也可以。" />}
            {!loading && diaries.length > 0 && (
              <div className="notebook-pages">
                {groupedDiaries.map((group) => (
                  <section key={group.label} className="day-page">
                    <h2>{group.label}</h2>
                    <div className="feed-list">
                      {group.items.map((diary) => (
                        <DiaryEntry
                          key={diary.id}
                          diary={diary}
                          author={memberFor(members, diary.authorId)}
                          currentUserId={session.user.id}
                          expanded={openDiaryId === diary.id}
                          onToggle={() => setOpenDiaryId(openDiaryId === diary.id ? null : diary.id)}
                          onPerson={() => {
                            setSelectedPersonId(diary.authorId);
                            setTab("friends");
                          }}
                          onStamp={(text) => addStamp(diary.id, text)}
                          onNote={(text) => addPaperNote(diary.id, text)}
                          onFollowUp={(text) => addFollowUp(diary.id, text)}
                          onHighlight={(start, end) => addHighlight(diary.id, start, end)}
                          onDoodlePreview={setDoodlePreview}
                          onDelete={() => deleteDiary(diary.id)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === "write" && (
          <WriteView
            onSubmit={addDiary}
            profile={profile}
            onUploadDoodle={uploadDoodleImage}
            onSaveDoodle={saveDoodleToApp}
            onLoadDoodles={loadMyDoodles}
          />
        )}

        {tab === "friends" && (
          <section className="stack">
            <div className="friend-switch">
              {sortedMembers.map((member) => (
                <button key={member.user_id} className={member.user_id === selectedPersonId ? "active" : ""} onClick={() => setSelectedPersonId(member.user_id)}>
                  {member.profile.display_name}
                </button>
              ))}
            </div>
            {selectedMember && (
              <article className="profile-panel" style={personStyle(selectedMember.profile)}>
                <AvatarSticker profile={selectedMember.profile} imageUrl={avatarDoodles[selectedMember.user_id]} large />
                <div>
                  <p className="eyebrow">最近在本子里写过</p>
                  <h2>{selectedMember.profile.display_name}</h2>
                </div>
              </article>
            )}
            <h3 className="section-title">这一页</h3>
            {selectedMemberDiaries.length === 0 && <EmptyState title="这一页还空着" text="等 ta 写下第一句话。" />}
            {selectedMemberDiaries.map((diary) => (
              <DiaryEntry
                key={diary.id}
                diary={diary}
                author={memberFor(members, diary.authorId)}
                currentUserId={session.user.id}
                expanded={openDiaryId === diary.id}
                onToggle={() => setOpenDiaryId(openDiaryId === diary.id ? null : diary.id)}
                onPerson={() => undefined}
                onStamp={(text) => addStamp(diary.id, text)}
                onNote={(text) => addPaperNote(diary.id, text)}
                onFollowUp={(text) => addFollowUp(diary.id, text)}
                onHighlight={(start, end) => addHighlight(diary.id, start, end)}
                onDoodlePreview={setDoodlePreview}
                onDelete={() => deleteDiary(diary.id)}
              />
            ))}
          </section>
        )}

        {tab === "week" && <WeekView diaries={diaries} members={members} />}
      </main>

      <nav className="bottom-nav">
        <NavButton active={tab === "feed"} icon={<Home size={19} />} label="本子" onClick={() => setTab("feed")} />
        <NavButton active={tab === "write"} icon={<Plus size={21} />} label="写一笔" onClick={() => setTab("write")} primary />
        <NavButton active={tab === "friends"} icon={<UserRound size={19} />} label="朋友" onClick={() => setTab("friends")} />
        <NavButton active={tab === "week"} icon={<CalendarDays size={19} />} label="本周" onClick={() => setTab("week")} />
      </nav>

      {doodlePreview && <DoodlePreview imageUrl={doodlePreview} onClose={() => setDoodlePreview(null)} />}
      {avatarEditor && (
        <AvatarDoodleEditor
          member={avatarEditor}
          imageUrl={avatarDoodles[avatarEditor.user_id] ?? null}
          onClose={() => setAvatarEditor(null)}
          onSave={(imageUrl) => {
            saveAvatarDoodle(avatarEditor.user_id, imageUrl);
            setAvatarEditor(null);
          }}
        />
      )}
    </div>
  );
}

function AvatarSticker({ profile, imageUrl, large = false }: { profile: Profile; imageUrl?: string | null; large?: boolean }) {
  const initial = avatarInitialForName(profile.display_name || profile.avatar_initial || "友");
  return (
    <span className={`avatar avatar-sticker ${large ? "large" : ""} ${imageUrl ? "has-image" : ""}`} style={personStyle(profile)}>
      {imageUrl ? <img src={imageUrl} alt={`${profile.display_name}留下的小头像`} /> : <span>{initial}</span>}
    </span>
  );
}

function AvatarDoodleEditor({
  member,
  imageUrl,
  onClose,
  onSave,
}: {
  member: Member;
  imageUrl: string | null;
  onClose: () => void;
  onSave: (imageUrl: string | null) => void;
}) {
  const color = getUserColor(member.profile.color_key);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const size = 220;

  useEffect(() => {
    restore(imageUrl);
  }, [imageUrl, color.paperSoft]);

  function prepare() {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = size * ratio;
    canvas.height = size * ratio;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = color.paperSoft || color.paper;
    context.fillRect(0, 0, size, size);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#332b25";
    context.lineWidth = 3;
    return context;
  }

  function restore(source: string | null) {
    const context = prepare();
    if (!context || !source) return;
    const image = new window.Image();
    image.onload = () => context.drawImage(image, 0, 0, size, size);
    image.src = source;
  }

  function pointFor(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * size,
      y: ((event.clientY - rect.top) / rect.height) * size,
    };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    lastPoint.current = pointFor(event);
  }

  function draw(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !lastPoint.current) return;
    event.preventDefault();
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    const next = pointFor(event);
    context.beginPath();
    context.moveTo(lastPoint.current.x, lastPoint.current.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    lastPoint.current = next;
  }

  function stop(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    event.preventDefault();
    drawing.current = false;
    lastPoint.current = null;
  }

  function clear() {
    prepare();
  }

  function save() {
    onSave(canvasRef.current?.toDataURL("image/png") ?? null);
  }

  return (
    <div className="avatar-editor-overlay" onClick={onClose}>
      <section className="avatar-editor-paper" style={colorVars(color, "avatar")} onClick={(event) => event.stopPropagation()}>
        <div>
          <p className="eyebrow">给自己画一枚小贴纸</p>
          <h2>{member.profile.display_name}</h2>
        </div>
        <canvas
          ref={canvasRef}
          className="avatar-doodle-canvas"
          aria-label="绘制头像贴纸"
          onPointerDown={start}
          onPointerMove={draw}
          onPointerUp={stop}
          onPointerCancel={stop}
        />
        <div className="avatar-editor-actions">
          <button type="button" onClick={clear}>清空</button>
          <button type="button" onClick={save}>保存</button>
          <button type="button" onClick={onClose}>合上</button>
        </div>
      </section>
    </div>
  );
}

function DiaryEntry({
  diary,
  author,
  currentUserId,
  expanded,
  onToggle,
  onPerson,
  onStamp,
  onNote,
  onFollowUp,
  onHighlight,
  onDoodlePreview,
  onDelete,
}: {
  diary: Diary;
  author: Member;
  currentUserId: string;
  expanded: boolean;
  onToggle: () => void;
  onPerson: () => void;
  onStamp: (text: string) => void;
  onNote: (text: string) => void;
  onFollowUp: (text: string) => void;
  onHighlight: (start: number, end: number) => void;
  onDoodlePreview: (imageUrl: string) => void;
  onDelete: () => Promise<void>;
}) {
  const [composer, setComposer] = useState<Composer>(null);
  const [openNote, setOpenNote] = useState<number | null>(null);
  const [noteText, setNoteText] = useState("");
  const [followText, setFollowText] = useState("");
  const [highlightBubble, setHighlightBubble] = useState<HighlightBubble>(null);
  const [isTorn, setIsTorn] = useState(isTornDiary(diary));
  const textRef = useRef<HTMLParagraphElement>(null);
  const isAuthor = diary.authorId === currentUserId;

  async function tearPage() {
    setIsTorn(true);
    setComposer(null);
    try {
      await onDelete();
    } catch {
      setIsTorn(false);
    }
  }

  function toggleComposer(next: Composer) {
    setComposer((current) => (current === next ? null : next));
  }

  function handleTextSelection() {
    const textElement = textRef.current;
    const selection = window.getSelection();
    if (!textElement || !selection || selection.isCollapsed || selection.rangeCount === 0) {
      setHighlightBubble(null);
      return;
    }

    const range = selection.getRangeAt(0);
    if (!textElement.contains(range.startContainer) || !textElement.contains(range.endContainer)) {
      setHighlightBubble(null);
      return;
    }

    const selectedText = selection.toString();
    if (!selectedText.trim()) {
      setHighlightBubble(null);
      return;
    }

    const preRange = document.createRange();
    preRange.selectNodeContents(textElement);
    preRange.setEnd(range.startContainer, range.startOffset);
    const start = preRange.toString().length;
    const end = start + selectedText.length;
    const rect = range.getBoundingClientRect();
    const parentRect = textElement.getBoundingClientRect();
    setHighlightBubble({ start, end, x: rect.left + rect.width / 2 - parentRect.left, y: rect.top - parentRect.top });
  }

  function applyHighlight() {
    if (!highlightBubble) return;
    onHighlight(highlightBubble.start, highlightBubble.end);
    setHighlightBubble(null);
    window.getSelection()?.removeAllRanges();
  }

  return (
    <article className={`diary-entry ${expanded ? "is-expanded" : ""} ${isTorn ? "is-torn" : ""}`} style={personStyle(author.profile)}>
      <div className="loose-leaf-holes" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>

      <div className="diary-head">
        <button className="person-link" onClick={onPerson}>
          <strong>{author.profile.display_name}</strong>
        </button>
      </div>

      <DiaryPageMeta diaryDate={diary.diaryDate} weather={diary.weather} />
      <MoodLine moodTone={diary.moodTone} moodWords={diary.moodWords} fallbackMood={diary.status} />

      {isTorn ? (
        <div className="torn-page-remnant" aria-hidden="true" />
      ) : (
        <>
          <div className="diary-body">
            {diary.doodleUrl && (
              <button className="diary-doodle-sticker" type="button" onClick={() => onDoodlePreview(diary.doodleUrl!)}>
                <img src={diary.doodleUrl} alt="这页夹着一张涂鸦便利贴" />
              </button>
            )}
            <p className="diary-text" ref={textRef} onMouseUp={handleTextSelection} onKeyUp={handleTextSelection}>
              <HighlightedText text={diary.text} highlights={diary.highlights} />
              {highlightBubble && (
                <button
                  className="highlight-bubble"
                  style={{ left: `${highlightBubble.x}px`, top: `${highlightBubble.y}px` }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={applyHighlight}
                >
                  划一下
                </button>
              )}
            </p>
            {diary.followUps.map((item, index) => (
              <p className="follow-line" key={`${item.time}-${index}`}>
                <span>ps：</span>{item.text}
              </p>
            ))}
            {diary.responses.length > 0 && <StampTrail stamps={diary.responses} />}
          </div>

          <button className="detail-button" onClick={onToggle}>
            <MessageCircle size={16} />
            {expanded ? "合上页角" : quietSummary(diary)}
          </button>

          {expanded && (
            <div className="entry-expanded">
              <div className="quiet-actions">
                <button onClick={() => toggleComposer("stamp")}>盖个小印章</button>
                <button onClick={() => toggleComposer("note")}>夹一张小纸条</button>
                {isAuthor && <button onClick={() => toggleComposer("follow")}>再补一句</button>}
                {isAuthor && <button onClick={tearPage}>撕掉这一页</button>}
              </div>

              {composer === "stamp" && (
                <div className="stamp-picker" aria-label="选择小印章">
                  {stampOptions.map((stamp) => {
                    const Icon = stamp.icon;
                    return (
                      <button
                        className={`stamp-option stamp-${stamp.name}`}
                        key={stamp.name}
                        onClick={() => {
                          onStamp(stamp.name);
                          setComposer(null);
                        }}
                      >
                        <Icon size={17} />
                        <span>{stamp.name}</span>
                        <small>{stamp.hint}</small>
                      </button>
                    );
                  })}
                </div>
              )}

              {diary.comments.length > 0 && (
                <section className="paper-notes-area">
                  <h3>朋友们夹了几张小纸条</h3>
                  <div className="paper-notes">
                    {diary.comments.map((item, index) => (
                      <button
                        key={`${item.by}-${index}`}
                        className={`paper-note ${openNote === index ? "open" : ""}`}
                        style={{
                          "--tilt": `${index % 2 === 0 ? -2 : 2}deg`,
                          "--lift": `${index * -7}px`,
                          ...colorVars(getUserColor(item.colorKey), "note"),
                        } as React.CSSProperties}
                        onClick={() => setOpenNote(openNote === index ? null : index)}
                      >
                        <strong>{item.by}</strong>
                        <span>{openNote === index ? item.text : shortText(item.text)}</span>
                        <small>{item.time}</small>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {composer === "note" && (
                <InlineForm
                  value={noteText}
                  setValue={setNoteText}
                  placeholder="写在一张小纸条上"
                  button="夹上"
                  onSubmit={(text) => {
                    onNote(text);
                    setComposer(null);
                  }}
                />
              )}

              {composer === "follow" && isAuthor && (
                <InlineForm
                  value={followText}
                  setValue={setFollowText}
                  placeholder="后来又想补一句"
                  button="补上"
                  onSubmit={(text) => {
                    onFollowUp(text);
                    setComposer(null);
                  }}
                />
              )}
            </div>
          )}
        </>
      )}
    </article>
  );
}

function AuthPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [colorKey, setColorKey] = useState<UserColorKey>(defaultUserColor.key);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage(null);
    try {
      const authCall =
        mode === "signup"
          ? supabase.auth.signUp({
              email,
              password,
              options: { data: { display_name: displayName || email.split("@")[0], color_key: colorKey } },
            })
          : supabase.auth.signInWithPassword({ email, password });

      const { error } = await authCall;
      if (error) throw error;
      setMessage(mode === "signup" ? "如果开启了邮箱验证，请先去邮箱里确认一下。" : "已经进来了。");
    } catch (authError) {
      setMessage(errorMessage(authError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <main className="phone-shell auth-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">只给亲近的人看</p>
            <h1>我们的小本子</h1>
          </div>
        </header>
        <section className="entry-panel">
          <h2>进到你们的小本子</h2>
          <p>用邮箱登录。这里不用展示，只是把日子轻轻放下来。</p>
          <form className="write-form" onSubmit={submit}>
            {mode === "signup" && (
              <>
                <label className="field-label">
                  你想被怎么称呼
                  <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="比如：阿树" />
                </label>
                <ColorPicker selected={colorKey} onSelect={setColorKey} />
              </>
            )}
            <label className="field-label">
              邮箱
              <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
            </label>
            <label className="field-label">
              密码
              <input type="password" required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 6 位" />
            </label>
            <button className="publish-button" disabled={busy}>{busy ? "稍等一下" : mode === "signup" ? "注册并进入" : "登录"}</button>
          </form>
          <button className="text-link" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
            {mode === "signin" ? "还没有账号，先注册" : "已有账号，去登录"}
          </button>
          {message && <p className="small-note-line">{message}</p>}
        </section>
      </main>
    </div>
  );
}

function NotebookEntryPage({
  loading,
  error,
  memberships,
  onCreate,
  onJoin,
  onSelect,
  onSignOut,
}: {
  loading: boolean;
  error: string | null;
  memberships: NotebookMembership[];
  onCreate: (name: string) => void;
  onJoin: (code: string) => void;
  onSelect: (notebook: Notebook) => void;
  onSignOut: () => void;
}) {
  const [name, setName] = useState("我们的小本子");
  const [code, setCode] = useState("");

  return (
    <div className="app">
      <main className="phone-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">先找到你们那一本</p>
            <h1>我们的小本子</h1>
          </div>
          <button className="text-link" onClick={onSignOut}>退出</button>
        </header>

        {error && <p className="error-note">{error}</p>}
        {loading && <EmptyState title="正在翻页" text="稍等一下。" />}

        {memberships.length > 0 && (
          <section className="entry-panel">
            <h2>选择一本</h2>
            <div className="notebook-choice-list">
              {memberships.map((membership) => (
                <button key={membership.notebook.id} className="notebook-choice" onClick={() => onSelect(membership.notebook)}>
                  <strong>{membership.notebook.name}</strong>
                  <small>邀请码：{membership.notebook.invite_code}</small>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="entry-panel">
          <h2>新建一本</h2>
          <form className="inline-form" onSubmit={(event) => { event.preventDefault(); onCreate(name); }}>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="我们的小本子" />
            <button>新建</button>
          </form>
        </section>

        <section className="entry-panel">
          <h2>用邀请码加入</h2>
          <form className="inline-form" onSubmit={(event) => { event.preventDefault(); onJoin(code); }}>
            <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="输入 8 位邀请码" />
            <button>加入</button>
          </form>
        </section>
      </main>
    </div>
  );
}

function ColorSetupPage({ profile, onSaved }: { profile: Profile; onSaved: (profile: Profile) => void }) {
  const [colorKey, setColorKey] = useState<UserColorKey>(stableColorKey(profile.id));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function saveColor() {
    if (!supabase) return;
    setSaving(true);
    setMessage(null);
    const { data, error } = await supabase
      .from("profiles")
      .update({ color_key: colorKey })
      .eq("id", profile.id)
      .select("id,display_name,avatar_initial,color_key")
      .single();
    setSaving(false);
    if (error) {
      setMessage(errorMessage(error));
      return;
    }
    onSaved(data as Profile);
  }

  return (
    <div className="app">
      <main className="phone-shell auth-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">第一次进本子前</p>
            <h1>给自己选一支笔</h1>
          </div>
        </header>
        <section className="entry-panel">
          <p>这会成为你在小本子里的纸面痕迹。文字还是深墨色，颜色只轻轻留在纸边、纸条、印章和高光里。</p>
          <ColorPicker selected={colorKey} onSelect={setColorKey} />
          <button className="publish-button" onClick={saveColor} disabled={saving}>{saving ? "正在放进笔袋" : "就用这支"}</button>
          {message && <p className="small-note-line">{message}</p>}
        </section>
      </main>
    </div>
  );
}

function ColorPicker({ selected, onSelect }: { selected: UserColorKey; onSelect: (key: UserColorKey) => void }) {
  return (
    <div className="color-picker">
      <p className="color-picker-title">选一支笔</p>
      <div className="color-options">
        {userColors.map((color) => (
          <button
            type="button"
            key={color.key}
            className={`color-option ${selected === color.key ? "selected" : ""}`}
            style={{
              "--person-base": color.base,
              "--person-paper": color.paper,
              "--person-light": color.light,
            } as React.CSSProperties}
            onClick={() => onSelect(color.key)}
          >
            <span className="color-paper-swatch" />
            <strong>{color.name}</strong>
          </button>
        ))}
      </div>
    </div>
  );
}

function WriteView({
  onSubmit,
  profile,
  onUploadDoodle,
  onSaveDoodle,
  onLoadDoodles,
}: {
  onSubmit: (text: string, mood: Status | null, diaryDate: string, weather: WeatherKey | null, moodTone: MoodTone | null, moodWords: string[], doodleUrl: string | null) => Promise<void>;
  profile: Profile | null;
  onUploadDoodle: (dataUrl: string) => Promise<string>;
  onSaveDoodle: (dataUrl: string) => Promise<string>;
  onLoadDoodles: () => Promise<SavedDoodle[]>;
}) {
  const [text, setText] = useState("");
  const [diaryDate, setDiaryDate] = useState(() => localDateKey(new Date()));
  const [weather, setWeather] = useState<WeatherKey | null>(null);
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);
  const [customPromptOpen, setCustomPromptOpen] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [moodTone, setMoodTone] = useState<MoodTone | null>(null);
  const [moodSliderValue, setMoodSliderValue] = useState(50);
  const [moodWords, setMoodWords] = useState<string[]>([]);
  const [doodleOpen, setDoodleOpen] = useState(false);
  const [doodleImage, setDoodleImage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [writeMessage, setWriteMessage] = useState<string | null>(null);
  const currentPrompt = customPrompt.trim() ? formatPromptTag(customPrompt) : selectedPrompt ? formatPromptTag(selectedPrompt) : null;
  const shownMoodTone = moodTone ?? moodToneFromValue(moodSliderValue);
  const activeMoodOption = getMoodToneOption(shownMoodTone) ?? moodToneOptions[2];

  async function submit(event: FormEvent) {
    event.preventDefault();
    if ((!text.trim() && !doodleImage) || !diaryDate || submitting) return;
    setSubmitting(true);
    setWriteMessage(null);
    try {
      let finalDoodleUrl = doodleImage;
      if (finalDoodleUrl?.startsWith("data:")) {
        finalDoodleUrl = await onUploadDoodle(finalDoodleUrl);
      }
      await onSubmit(text.trim(), null, diaryDate, weather, moodTone, moodWords, finalDoodleUrl);
      setText("");
      setDiaryDate(localDateKey(new Date()));
      setWeather(null);
      setSelectedPrompt(null);
      setCustomPrompt("");
      setCustomPromptOpen(false);
      setMoodTone(null);
      setMoodSliderValue(50);
      setMoodWords([]);
      setDoodleOpen(false);
      setDoodleImage(null);
    } catch (submitError) {
      setWriteMessage(errorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  function choosePrompt(prompt: string) {
    setSelectedPrompt((value) => (value === prompt ? null : prompt));
    setCustomPrompt("");
  }

  function updateCustomPrompt(value: string) {
    const nextValue = value.slice(0, 24);
    setCustomPrompt(nextValue);
    if (nextValue.trim()) setSelectedPrompt(null);
  }

  function updateMoodTone(value: number) {
    setMoodSliderValue(value);
    setMoodTone(moodToneFromValue(value));
    setMoodWords([]);
  }

  function toggleMoodWord(word: string) {
    if (!moodTone) setMoodTone(shownMoodTone);
    setMoodWords((current) => {
      if (current.includes(word)) {
        return current.filter((item) => item !== word);
      }
      return [...current, word].slice(-3);
    });
  }

  return (
    <section className="write-view">
      <p className="eyebrow">不用组织得很好</p>
      <h2>今天有什么小事想放下来？</h2>
      <form onSubmit={submit} className="write-form">
        <div className="diary-fields">
          <div className="diary-meta-fields">
            <label className="diary-date-field">
              <span>Date:</span>
              <input type="date" value={diaryDate} onChange={(event) => setDiaryDate(event.target.value)} required />
            </label>
            <div className="weather-field" role="group" aria-label="Weather">
              <span className="weather-label">Weather:</span>
              <div className="weather-options">
                {weatherOptions.map((option) => {
                  const Icon = option.icon;
                  return (
                    <button
                      type="button"
                      key={option.key}
                      className={weather === option.key ? "selected" : ""}
                      aria-pressed={weather === option.key}
                      onClick={() => setWeather(weather === option.key ? null : option.key)}
                    >
                      <Icon size={16} />
                      <span>{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        <div className={`compose-paper-stage ${doodleOpen ? "doodle-is-open" : ""}`}>
          <div className="compose-paper">
            <div className="prompt-field">
              <div className="prompt-strip">
                {promptOptions.map((prompt) => (
                  <button
                    type="button"
                    key={prompt}
                    className={selectedPrompt === prompt && !customPrompt.trim() ? "selected" : ""}
                    aria-pressed={selectedPrompt === prompt && !customPrompt.trim()}
                    onClick={() => choosePrompt(prompt)}
                  >
                    <span className="prompt-option-text">{prompt}</span>
                  </button>
                ))}
                <button
                  type="button"
                  className={`custom-prompt-toggle ${customPrompt.trim() ? "selected" : ""}`}
                  aria-pressed={Boolean(customPrompt.trim())}
                  onClick={() => setCustomPromptOpen((value) => !value)}
                >
                  #自定义
                </button>
                {currentPrompt && customPrompt.trim() && <small className="current-custom-prompt">{currentPrompt}</small>}
              </div>
              {customPromptOpen && (
                <input
                  className="custom-prompt-input"
                  value={customPrompt}
                  onChange={(event) => updateCustomPrompt(event.target.value)}
                  placeholder="比如 #今天风很好"
                  maxLength={24}
                />
              )}
            </div>
            <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="想说鼠莫？" />
          </div>
          <DoodleComposer
            open={doodleOpen}
            onOpenChange={setDoodleOpen}
            image={doodleImage}
            onImageChange={setDoodleImage}
            profile={profile}
            onSaveDoodle={onSaveDoodle}
            onLoadDoodles={onLoadDoodles}
          />
        </div>
        <div className="mood-temperature">
          <div className="mood-temperature-head">
            <div>
              <h3>心情色温</h3>
              <p>今天心情肿么样？</p>
            </div>
            {moodTone && <span>{activeMoodOption.label}</span>}
          </div>
          <div className="tone-slider-row">
            <span>暗暗嘟</span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={moodSliderValue}
              onChange={(event) => updateMoodTone(Number(event.target.value))}
              aria-label="心情色温"
            />
            <span>亮亮嘟</span>
          </div>
          <div className="mood-word-area">
            <p>也许像：</p>
            <div className="mood-word-grid">
              {activeMoodOption.words.map((word) => (
                <button
                  type="button"
                  key={word}
                  className={moodWords.includes(word) ? "selected" : ""}
                  aria-pressed={moodWords.includes(word)}
                  onClick={() => toggleMoodWord(word)}
                >
                  {word}
                </button>
              ))}
            </div>
          </div>
        </div>
        <button className="publish-button" disabled={submitting}>{submitting ? "正在夹进本子" : "写进本子"}</button>
        {writeMessage && <p className="small-note-line">{writeMessage}</p>}
      </form>
    </section>
  );
}

function DoodleComposer({
  open,
  onOpenChange,
  image,
  onImageChange,
  profile,
  onSaveDoodle,
  onLoadDoodles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  image: string | null;
  onImageChange: (image: string | null) => void;
  profile: Profile | null;
  onSaveDoodle: (dataUrl: string) => Promise<string>;
  onLoadDoodles: () => Promise<SavedDoodle[]>;
}) {
  const color = getUserColor(profile?.color_key);
  const [savedOpen, setSavedOpen] = useState(false);
  const [savedDoodles, setSavedDoodles] = useState<SavedDoodle[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function closeWhenOutside(event: PointerEvent) {
      const target = event.target as Node;
      if (drawerRef.current?.contains(target)) return;
      onOpenChange(false);
    }

    document.addEventListener("pointerdown", closeWhenOutside);
    return () => document.removeEventListener("pointerdown", closeWhenOutside);
  }, [open, onOpenChange]);

  async function toggleSavedDoodles() {
    const nextOpen = !savedOpen;
    setSavedOpen(nextOpen);
    if (!nextOpen || savedDoodles.length) return;
    setLoadingSaved(true);
    setMessage(null);
    try {
      setSavedDoodles(await onLoadDoodles());
    } catch (loadError) {
      setSavedDoodles([]);
      setMessage(isMissingDoodlesTableError(loadError) ? "还没有存过涂鸦。" : "暂时没翻到以前的涂鸦。");
    } finally {
      setLoadingSaved(false);
    }
  }

  return (
    <section className={`doodle-compose ${open ? "is-open" : ""} ${image ? "has-doodle" : ""}`} style={colorVars(color, "doodle") as React.CSSProperties}>
      {!open && (
        <div className="doodle-peek-zone">
          <div className="doodle-hand-cue" aria-hidden="true">
            <span>可以涂一下</span>
            <svg viewBox="0 0 92 44" focusable="false">
              <path d="M4 18c20-7 43 1 74 14" />
              <path d="M78 32c-8-1-14 1-20 5" />
              <path d="M78 32c-4-7-9-12-17-16" />
            </svg>
          </div>
          <button type="button" className="doodle-peek" aria-label="涂一下" onClick={() => onOpenChange(true)}>
            <span />
          </button>
        </div>
      )}

      {open && (
        <div className="doodle-drawer" ref={drawerRef}>
          <div className="doodle-sheet-head">
            <span>涂一下</span>
          </div>
          <DoodlePad
            color={color}
            image={image}
            onImageChange={onImageChange}
            onSaveDoodle={onSaveDoodle}
            onSaved={(url) => {
              onImageChange(url);
              setMessage("已经存进本子，下次也能用了。");
              setSavedDoodles((items) => [{ id: url, imageUrl: url, createdAt: new Date().toISOString() }, ...items]);
            }}
            onMessage={setMessage}
            libraryControl={
              <button type="button" onClick={toggleSavedDoodles}>
                用以前涂过的
              </button>
            }
          />
          {message && <small className="doodle-message">{message}</small>}
          {savedOpen && (
            <div className="doodle-library">
              {loadingSaved && <p>正在翻以前的小涂鸦。</p>}
              {!loadingSaved && savedDoodles.length === 0 && <p>还没有存过涂鸦。</p>}
              {!loadingSaved && savedDoodles.length > 0 && (
                <div className="doodle-library-grid">
                  {savedDoodles.map((doodle) => (
                    <button
                      type="button"
                      key={doodle.id}
                      onClick={() => {
                        onImageChange(doodle.imageUrl);
              setMessage("这张已经夹到这页了。");
                      }}
                    >
                      <img src={doodle.imageUrl} alt="以前涂过的一张便利贴" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function DoodlePad({
  color,
  image,
  onImageChange,
  onSaveDoodle,
  onSaved,
  onMessage,
  libraryControl,
}: {
  color: ReturnType<typeof getUserColor>;
  image: string | null;
  onImageChange: (image: string | null) => void;
  onSaveDoodle: (dataUrl: string) => Promise<string>;
  onSaved: (url: string) => void;
  onMessage: (message: string | null) => void;
  libraryControl: React.ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const drawing = useRef(false);
  const [history, setHistory] = useState<(string | null)[]>([]);
  const [saving, setSaving] = useState(false);
  const size = 640;

  useEffect(() => {
    restoreCanvas(image);
  }, [image, color.paperSoft]);

  function prepareCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = size * ratio;
    canvas.height = size * ratio;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = color.paperSoft || color.paper;
    context.fillRect(0, 0, size, size);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#332b25";
    context.lineWidth = 3;
    return context;
  }

  function restoreCanvas(source: string | null) {
    const context = prepareCanvas();
    if (!context || !source) return;
    const imageElement = new window.Image();
    imageElement.crossOrigin = "anonymous";
    imageElement.onload = () => {
      context.drawImage(imageElement, 0, 0, size, size);
    };
    imageElement.src = source;
  }

  function pointFor(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * size,
      y: ((event.clientY - rect.top) / rect.height) * size,
    };
  }

  function exportImage() {
    return canvasRef.current?.toDataURL("image/png") ?? "";
  }

  function startDrawing(event: React.PointerEvent<HTMLCanvasElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setHistory((items) => [...items.slice(-24), image]);
    drawing.current = true;
    lastPoint.current = pointFor(event);
    const context = canvasRef.current?.getContext("2d");
    if (!context || !lastPoint.current) return;
    context.beginPath();
    context.arc(lastPoint.current.x, lastPoint.current.y, 1.25, 0, Math.PI * 2);
    context.fillStyle = "#332b25";
    context.fill();
  }

  function draw(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !lastPoint.current) return;
    event.preventDefault();
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    const nextPoint = pointFor(event);
    context.beginPath();
    context.moveTo(lastPoint.current.x, lastPoint.current.y);
    context.lineTo(nextPoint.x, nextPoint.y);
    context.stroke();
    lastPoint.current = nextPoint;
  }

  function stopDrawing(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    event.preventDefault();
    drawing.current = false;
    lastPoint.current = null;
    onImageChange(exportImage());
  }

  function undo() {
    const previous = history[history.length - 1] ?? null;
    setHistory((items) => items.slice(0, -1));
    onImageChange(previous);
    restoreCanvas(previous);
    onMessage(previous ? "撤回到上一笔了。" : "这张便利贴又空了。");
  }

  function clear() {
    setHistory((items) => [...items.slice(-24), image]);
    onImageChange(null);
    restoreCanvas(null);
    onMessage("已经清空。");
  }

  function saveLocal() {
    const dataUrl = exportImage();
    if (!dataUrl) return;
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `our-diary-doodle-${localDateKey(new Date())}.png`;
    if (typeof link.download === "string") {
      document.body.appendChild(link);
      link.click();
      link.remove();
      onMessage("已经保存到本地。");
    } else {
      window.open(dataUrl, "_blank");
    }
  }

  async function saveApp() {
    const dataUrl = exportImage();
    if (!dataUrl || saving) return;
    setSaving(true);
    onMessage(null);
    try {
      const url = await onSaveDoodle(dataUrl);
      onSaved(url);
    } catch (saveError) {
      onMessage(isMissingDoodlesTableError(saveError) ? "涂鸦库还没准备好，先存到本地也可以。" : errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="doodle-pad">
      <div className="doodle-tools doodle-tools-left">
        <button type="button" onClick={undo} disabled={history.length === 0}>撤一下</button>
        <button type="button" onClick={clear}>清空</button>
      </div>
      <canvas
        ref={canvasRef}
        aria-label="涂一下便利贴"
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={stopDrawing}
        onPointerCancel={stopDrawing}
      />
      <div className="doodle-tools doodle-tools-right">
        <button type="button" onClick={saveLocal}>存到本地</button>
        <button type="button" onClick={saveApp} disabled={saving}>{saving ? "存着呢" : "存进本子"}</button>
        {libraryControl}
      </div>
    </div>
  );
}

function DoodlePreview({ imageUrl, onClose }: { imageUrl: string; onClose: () => void }) {
  return (
    <div className="doodle-preview-overlay" onClick={onClose}>
      <div className="doodle-preview-note" onClick={(event) => event.stopPropagation()}>
        <img src={imageUrl} alt="放大的涂鸦便利贴" />
      </div>
    </div>
  );
}

function WeekView({ diaries, members }: { diaries: Diary[]; members: Member[] }) {
  const [showNotebookWords, setShowNotebookWords] = useState(false);
  const weekRange = currentWeekRange();
  const thisWeekDiaries = diaries.filter((diary) => isDiaryInRange(diary, weekRange.start, weekRange.end));
  const activeAuthors = [...new Set(thisWeekDiaries.map((diary) => memberFor(members, diary.authorId).profile.display_name))];
  const tiredCount = thisWeekDiaries.filter((diary) => diary.status === "有点累" || diary.status === "卡住了").length;
  const weeklyCharacterCount = countDiaryWords(thisWeekDiaries);
  const notebookCharacterCount = countDiaryWords(diaries);
  const weeklySummary = generateWeeklySummary(diaries, members);

  return (
    <section className="week-view stack">
      <article className="week-hero">
        <HeartHandshake size={28} />
        <div>
          <p className="eyebrow">翻到这一周</p>
          <h2>{weeklySummary}</h2>
        </div>
      </article>
      {diaries.length < 2 ? (
        <EmptyState title="这一周还没留下太多字" text="多写几笔之后，这里会轻轻收拢大家的近况。" />
      ) : (
        <div className="summary-grid">
          <Summary title="这周谁写过" text={activeAuthors.join("、") || "还没有人落笔。"} />
          <Summary
            title="留下了多少字"
            text={
              showNotebookWords
                ? `整本小本子里一共有 ${notebookCharacterCount} 个字。`
                : weeklyCharacterCount
                  ? `${weeklyCharacterCount} 个字被放进本子里。`
                  : "这周还没留下新的字。"
            }
            onClick={() => setShowNotebookWords((value) => !value)}
          />
          <Summary title="需要被照看的状态" text={tiredCount ? `有 ${tiredCount} 条日记提到累或卡住。` : "这周没有太多沉重的状态。"} />
          <Summary title="这周的小词" text={extractKeywords(thisWeekDiaries)} />
        </div>
      )}
    </section>
  );
}

function currentWeekRange() {
  const start = startOfLocalWeek(new Date());
  return { start, end: addDays(start, 7) };
}

function countDiaryWords(diaries: Diary[]) {
  return diaries.reduce((total, diary) => {
    const diaryTextCount = countTextCharacters(diary.text);
    const followUpCount = diary.followUps.reduce((count, followup) => count + countTextCharacters(followup.text), 0);
    const noteCount = diary.comments.reduce((count, note) => count + countTextCharacters(note.text), 0);
    return total + diaryTextCount + followUpCount + noteCount;
  }, 0);
}

function countTextCharacters(text: string) {
  if (isTornText(text)) return 0;
  return Array.from(text.replace(/\s/g, "")).length;
}

function isTornDiary(diary: Diary) {
  return isTornText(diary.text);
}

function isTornText(text: string) {
  return text === tornPageMarker;
}

function generateWeeklySummary(diaries: Diary[], members: Member[]) {
  const now = new Date();
  const thisWeekStart = startOfLocalWeek(now);
  const nextWeekStart = addDays(thisWeekStart, 7);
  const lastWeekStart = addDays(thisWeekStart, -7);
  const thisWeekDiaries = diaries.filter((diary) => isDiaryInRange(diary, thisWeekStart, nextWeekStart));
  const lastWeekDiaries = diaries.filter((diary) => isDiaryInRange(diary, lastWeekStart, thisWeekStart));
  const activeAuthorCount = new Set(thisWeekDiaries.map((diary) => diary.authorId)).size;
  const noteCount = thisWeekDiaries.reduce((count, diary) => count + diary.comments.filter((note) => isDateInRange(note.createdAt, thisWeekStart, nextWeekStart)).length, 0);
  const stampCount = thisWeekDiaries.reduce((count, diary) => count + diary.responses.filter((stamp) => isDateInRange(stamp.createdAt, thisWeekStart, nextWeekStart)).length, 0);

  if (activeAuthorCount >= Math.min(2, Math.max(1, members.length))) {
    return pickWeeklyLine([
      "这一周，大家都来本子里写了一笔。",
      "这一页，又留下了几个人的字迹。",
      "这周，本子里出现了大家的新笔迹。",
    ], thisWeekDiaries.length + activeAuthorCount + noteCount + stampCount);
  }

  const topTag = topWeeklyTag(thisWeekDiaries);
  if (topTag) {
    const tagLine = weeklyTagLine(topTag);
    if (tagLine) return tagLine;
  }

  if (thisWeekDiaries.length > lastWeekDiaries.length) {
    return pickWeeklyLine(["这周，多了一些想留下的话。", "这一页，多了些新的痕迹。"], thisWeekDiaries.length);
  }

  if (lastWeekDiaries.length > 0 && thisWeekDiaries.length < lastWeekDiaries.length) {
    return pickWeeklyLine(["这周，本子安静了一些。", "这一周，字迹少了一点。"], lastWeekDiaries.length - thisWeekDiaries.length);
  }

  const moodLine = weeklyMoodLine(thisWeekDiaries);
  if (moodLine) return moodLine;

  if (noteCount || stampCount) return "这周，有人轻轻回应了几笔。";
  return thisWeekDiaries.length ? "本子还在慢慢写满。" : "这一页，还在等待新的痕迹。";
}

function startOfLocalWeek(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  const day = next.getDay() || 7;
  next.setDate(next.getDate() - day + 1);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isDiaryInRange(diary: Diary, start: Date, end: Date) {
  const date = new Date(`${diary.diaryDate || localDateKey(new Date(diary.createdAt))}T00:00:00`);
  return date >= start && date < end;
}

function isDateInRange(value: string | undefined, start: Date, end: Date) {
  if (!value) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date >= start && date < end;
}

function topWeeklyTag(diaries: Diary[]) {
  const counts = new Map<string, number>();
  diaries.forEach((diary) => {
    const tag = normalizeWeeklyTag((diary as any).entry_tag ?? (diary as any).entryTag ?? (diary as any).prompt_tag ?? (diary as any).promptTag ?? (diary as any).tag);
    if (!tag) return;
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  });
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

function normalizeWeeklyTag(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^#/, "");
  return trimmed || null;
}

function weeklyTagLine(tag: string) {
  if (tag === "想被听见") return "这一周，有些小事想被听见。";
  if (tag === "碎碎念") return "这一周，装下不少小念头。";
  if (tag === "奇思") return "这周，留下了几枚奇思。";
  if (tag === "说不清") return "这一周，也有说不清的心绪。";
  if (tag === "我跟你讲哦…") return "这周，有些话想慢慢讲。";
  return null;
}

function weeklyMoodLine(diaries: Diary[]) {
  const tones = diaries.map((diary) => diary.moodTone).filter(Boolean) as MoodTone[];
  if (!tones.length) return null;
  const scores: Record<MoodTone, number> = { very_dark: -2, dark: -1, middle: 0, bright: 1, very_bright: 2 };
  const total = tones.reduce((sum, tone) => sum + scores[tone], 0);
  const brightCount = tones.filter((tone) => scores[tone] > 0).length;
  const darkCount = tones.filter((tone) => scores[tone] < 0).length;
  const average = total / tones.length;

  if (brightCount > 0 && darkCount > 0 && Math.abs(average) < 0.7) {
    return "这一周，有亮光也有小情绪。";
  }
  if (average >= 0.7) return "这一周，留下更多亮亮痕迹。";
  if (average <= -0.7) return "这一周，也留下了一点疲惫。";
  return "这一周，心绪在中间晃晃。";
}

function pickWeeklyLine(lines: string[], seed: number) {
  return lines[Math.abs(seed) % lines.length];
}

function Summary({ title, text, onClick }: { title: string; text: string; onClick?: () => void }) {
  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (!onClick || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onClick();
  }

  return (
    <article
      className={`summary-card ${onClick ? "summary-card-secret" : ""}`}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}

function StampTrail({ stamps }: { stamps: { by: string; text: string; colorKey?: string | null }[] }) {
  return (
    <div className="stamp-trail" aria-label="已盖的小印章">
      {stamps.map((stamp, index) => {
        const option = stampOptions.find((item) => item.name === stamp.text) ?? stampOptions[4];
        const Icon = option.icon;
        return (
          <span
            className={`stamp-mark stamp-${option.name}`}
            key={`${stamp.by}-${stamp.text}-${index}`}
            style={colorVars(getUserColor(stamp.colorKey), "stamp") as React.CSSProperties}
          >
            <Icon size={15} />
            <small>{stamp.by} · {option.name === "读到了" ? "读到" : option.name}</small>
          </span>
        );
      })}
    </div>
  );
}

function DiaryPageMeta({ diaryDate, weather }: { diaryDate: string; weather?: string | null }) {
  const weatherOption = getWeatherOption(weather);
  const WeatherIcon = weatherOption?.icon;

  return (
    <div className="diary-page-meta">
      <p>
        <span className="diary-meta-label">Date:</span>
        <span className="diary-meta-value">{formatDiaryDate(diaryDate)}</span>
      </p>
      {weatherOption && WeatherIcon && (
        <p>
          <span className="diary-meta-label">Weather:</span>
          <span className="diary-meta-value weather-value">{weatherOption.label}</span>
          <WeatherIcon className="weather-icon" size={15} strokeWidth={1.7} aria-hidden="true" />
        </p>
      )}
    </div>
  );
}

function MoodLine({ moodTone, moodWords, fallbackMood }: { moodTone?: MoodTone | null; moodWords: string[]; fallbackMood?: Status | null }) {
  const toneLabel = getMoodToneOption(moodTone)?.label;
  const words = moodWords.length ? moodWords.join("、") : "";
  const value = [toneLabel, words].filter(Boolean).join(" · ") || fallbackMood;
  if (!value) return null;

  return (
    <p className="mood-line">
      <span>心里：</span>
      <strong>{value}</strong>
    </p>
  );
}

function HighlightedText({ text, highlights }: { text: string; highlights: HighlightRange[] }) {
  const normalized = normalizeHighlights(highlights, text.length);
  if (!normalized.length) return <>{text}</>;

  const pieces: React.ReactNode[] = [];
  let cursor = 0;
  normalized.forEach((highlight, index) => {
    if (highlight.start > cursor) pieces.push(text.slice(cursor, highlight.start));
    pieces.push(
      <span
        className={`hand-highlight highlight-variant-${index % 3}`}
        key={highlight.id}
        style={colorVars(getUserColor(highlight.colorKey), "highlight") as React.CSSProperties}
      >
        {text.slice(highlight.start, highlight.end)}
      </span>
    );
    cursor = highlight.end;
  });
  if (cursor < text.length) pieces.push(text.slice(cursor));
  return <>{pieces}</>;
}

function InlineForm({ value, setValue, placeholder, button, onSubmit }: { value: string; setValue: (value: string) => void; placeholder: string; button: string; onSubmit: (text: string) => void }) {
  return (
    <form
      className="inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!value.trim()) return;
        onSubmit(value.trim());
        setValue("");
      }}
    >
      <input value={value} onChange={(event) => setValue(event.target.value)} placeholder={placeholder} />
      <button>{button}</button>
    </form>
  );
}

function NavButton({ active, icon, label, onClick, primary }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button className={`${active ? "active" : ""} ${primary ? "primary" : ""}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <section className="empty-state">
      <h2>{title}</h2>
      <p>{text}</p>
    </section>
  );
}

function ShellMessage({ title, text }: { title: string; text: string }) {
  return (
    <div className="app">
      <main className="phone-shell">
        <EmptyState title={title} text={text} />
      </main>
    </div>
  );
}

function SetupMissing() {
  return <ShellMessage title="还没连上 Supabase" text="请先配置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。" />;
}

async function ensureProfile(user: User) {
  if (!supabase) throw new Error("Supabase 未配置");
  const displayName = String(user.user_metadata?.display_name || user.email?.split("@")[0] || "新朋友");
  const { data: existing, error: selectError } = await supabase
    .from("profiles")
    .select("id,display_name,avatar_initial,color_key")
    .eq("id", user.id)
    .maybeSingle();
  if (selectError) throw selectError;
  if (existing) return existing as Profile;

  const colorKey = String(user.user_metadata?.color_key || defaultUserColor.key);
  const profile = {
    id: user.id,
    display_name: displayName,
    avatar_initial: avatarInitialForName(displayName),
    color_key: colorKey,
  };
  const { data, error } = await supabase.from("profiles").insert(profile).select("id,display_name,avatar_initial,color_key").single();
  if (error) throw error;
  return data as Profile;
}

async function fetchByDiaryIds(table: string, ids: string[]) {
  if (!supabase || ids.length === 0) return [];
  const { data, error } = await supabase.from(table).select("*").in("diary_id", ids).order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

function memberFor(members: Member[], id: string): Member {
  return members.find((member) => member.user_id === id) ?? {
    user_id: id,
    role: "member",
    profile: fallbackProfile(id),
  };
}

function sortMembersByActivity(members: Member[], diaries: Diary[]) {
  return [...members].sort((left, right) => memberLastActivityAt(right, diaries) - memberLastActivityAt(left, diaries));
}

function memberLastActivityAt(member: Member, diaries: Diary[]) {
  let latest = 0;
  diaries.forEach((diary) => {
    if (diary.authorId === member.user_id) latest = Math.max(latest, timeValue(diary.createdAt));
    diary.comments.forEach((note) => {
      if (note.authorId === member.user_id) latest = Math.max(latest, timeValue(note.createdAt));
    });
    diary.responses.forEach((stamp) => {
      if (stamp.authorId === member.user_id) latest = Math.max(latest, timeValue(stamp.createdAt));
    });
    diary.followUps.forEach((followup) => {
      if (followup.authorId === member.user_id) latest = Math.max(latest, timeValue(followup.createdAt));
    });
  });
  return latest;
}

function memberTraceSummary(member: Member, diaries: Diary[]) {
  const latest = diaries.find((diary) => diary.authorId === member.user_id);
  if (!latest) return memberLastActivityAt(member, diaries) ? "最近来过" : "还没写过";

  const toneLabel = getMoodToneOption(latest.moodTone)?.label;
  const firstWord = latest.moodWords[0];
  const moodText = [toneLabel, firstWord].filter(Boolean).join(" · ");
  if (moodText) return moodText;
  if (latest.status) return latest.status;
  return "最近写过";
}

function timeValue(value?: string) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function personStyle(profile: Profile) {
  return colorVars(getUserColor(profile.color_key));
}

function fallbackProfile(id: string): Profile {
  return { id, display_name: "朋友", avatar_initial: "友", color_key: null };
}

const weakAvatarChars = new Set([
  "小",
  "大",
  "老",
  "阿",
  "叔",
  "姐",
  "哥",
  "兄",
  "妹",
  "弟",
  "师",
  "傅",
  "宝",
  "贝",
  "亲",
  "甜",
  "萌",
  "乖",
]);

const weakAvatarWords = ["阿姨", "师傅", "宝贝", "亲亲", "宝宝", "小可爱"];
const weakSingleLatin = new Set(["a", "b", "c", "x", "y", "z"]);

function avatarInitialForName(name: string) {
  const normalized = name.trim();
  if (!normalized) return "友";
  const compact = normalized.replace(/\s+/g, "");
  const withoutWeakWords = weakAvatarWords.reduce((value, word) => value.replaceAll(word, ""), compact);
  const chars = Array.from(withoutWeakWords || compact).filter((char) => !/[\s~～_\-.·,，。!！?？/\\|()[\]{}<>《》:;"'`]/.test(char));
  if (!chars.length) return "友";

  const meaningfulChinese = chars.filter((char) => isChineseChar(char) && !weakAvatarChars.has(char));
  if (meaningfulChinese.length) return meaningfulChinese[meaningfulChinese.length - 1];

  const chinese = chars.filter(isChineseChar);
  if (chinese.length >= 2) return chinese[chinese.length - 1];

  const letters = chars.filter((char) => /[A-Za-z]/.test(char));
  if (letters.length) {
    const upperLetters = letters.map((char) => char.toUpperCase());
    const useful = upperLetters.find((char) => !weakSingleLatin.has(char.toLowerCase()));
    if (useful) return useful;
    return upperLetters.slice(0, Math.min(2, upperLetters.length)).join("");
  }

  const digits = chars.filter((char) => /\d/.test(char));
  if (digits.length) return digits.join("").slice(0, 3);

  return chars[chars.length - 1] || "友";
}

function isChineseChar(char: string) {
  return /\p{Script=Han}/u.test(char);
}

const AVATAR_DOODLES_KEY = "our-diary-avatar-doodles";

function loadLocalAvatarDoodles() {
  try {
    const value = window.localStorage.getItem(AVATAR_DOODLES_KEY);
    if (!value) return {};
    return JSON.parse(value) as Record<string, string>;
  } catch {
    return {};
  }
}

function saveLocalAvatarDoodles(value: Record<string, string>) {
  try {
    window.localStorage.setItem(AVATAR_DOODLES_KEY, JSON.stringify(value));
  } catch {
    // 本地存储不可用时，只保留当前页面内的头像状态。
  }
}

function colorVars(color = defaultUserColor, prefix = "person") {
  return {
    [`--${prefix}-base`]: color.base,
    [`--${prefix}-paper`]: color.paper,
    [`--${prefix}-paper-soft`]: color.paperSoft,
    [`--${prefix}-light`]: color.light,
    [`--${prefix}-ambient`]: color.ambient,
    [`--${prefix}-highlight`]: color.highlight,
  };
}

function dataUrlToBlob(dataUrl: string) {
  const [metadata, base64] = dataUrl.split(",");
  const mime = metadata.match(/data:(.*);base64/)?.[1] ?? "image/png";
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
}

function isMissingDoodlesTableError(error: unknown) {
  const message = errorMessage(error);
  return message.includes("public.doodles") || message.includes("schema cache") || message.includes("Could not find the table");
}

const ambientPositions = [
  "12% 10%",
  "82% 12%",
  "24% 86%",
  "78% 78%",
  "48% 8%",
  "8% 58%",
  "92% 48%",
  "52% 92%",
];

function notebookBackgroundStyle(members: Member[]) {
  if (!members.length) return undefined;
  const colors = members.map((member) => getUserColor(member.profile.color_key));
  const opacity = Math.max(0.04, Math.min(0.1, 0.16 / colors.length));
  const washes = colors.map((color, index) => {
    const rgb = hexToRgb(color.ambient);
    const position = ambientPositions[index % ambientPositions.length];
    const radius = 34 + (index % 4) * 4;
    return `radial-gradient(circle at ${position}, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity.toFixed(3)}), transparent ${radius}%)`;
  });

  return {
    background: [
      ...washes,
      "radial-gradient(circle at 50% 8%, rgba(255, 249, 239, 0.46), transparent 38%)",
      "linear-gradient(135deg, #f7f1e7 0%, #eef2e7 100%)",
    ].join(", "),
    backgroundAttachment: "fixed",
  } as React.CSSProperties;
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized.length === 3 ? normalized.split("").map((char) => char + char).join("") : normalized, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function groupDiaries(diaries: Diary[]) {
  const today = startOfLocalDay(new Date());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const groups = new Map<string, Diary[]>();

  [...diaries].sort(compareDiaries).forEach((diary) => {
    const date = parseDiaryDate(diary.diaryDate);
    let label = formatDiaryDate(diary.diaryDate);
    if (date.getTime() === today.getTime()) label = "今天";
    else if (date.getTime() === yesterday.getTime()) label = "昨天";
    else if (date >= weekStart && date < yesterday) label = "这周早些时候";
    groups.set(label, [...(groups.get(label) ?? []), diary]);
  });

  return Array.from(groups, ([label, items]) => ({ label, items }));
}

function compareDiaries(a: Diary, b: Diary) {
  const byDiaryDate = b.diaryDate.localeCompare(a.diaryDate);
  return byDiaryDate || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDiaryDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDiaryDate(value: string) {
  const date = parseDiaryDate(value);
  return [String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0"), date.getFullYear()].join("/");
}

function formatNoteTime(value: string) {
  const date = new Date(value);
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusClass(status: Status) {
  return {
    开心: "happy",
    普通: "plain",
    有点累: "tired",
    卡住了: "stuck",
    想聊天: "chat",
    需要安静: "quiet",
  }[status];
}

function isStatus(value: unknown): value is Status {
  return typeof value === "string" && statusOptions.includes(value as Status);
}

function quietSummary(diary: Diary) {
  const parts = [];
  if (diary.responses.length) parts.push(`${diary.responses.length}枚小印章`);
  if (diary.comments.length) parts.push(`${diary.comments.length}张小纸条`);
  if (!parts.length) return "翻开看看";
  return parts.join(" · ");
}

function shortText(text: string) {
  return text.length > 16 ? `${text.slice(0, 16)}...` : text;
}

function formatPromptTag(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function parseMoodWords(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((word): word is string => typeof word === "string").slice(0, 3);
}

function mergeHighlights(highlights: HighlightRange[], next: HighlightRange) {
  return normalizeHighlights([...highlights, next], Number.MAX_SAFE_INTEGER).map((range, index) => ({
    ...range,
    id: range.id || `h${Date.now()}-${index}`,
  }));
}

function normalizeHighlights(highlights: HighlightRange[], textLength: number) {
  const sorted = highlights
    .map((highlight) => ({
      ...highlight,
      start: Math.max(0, Math.min(highlight.start, textLength)),
      end: Math.max(0, Math.min(highlight.end, textLength)),
    }))
    .filter((highlight) => highlight.end > highlight.start)
    .sort((a, b) => a.start - b.start);

  return sorted.reduce<HighlightRange[]>((merged, item) => {
    const last = merged[merged.length - 1];
    if (!last || item.start > last.end) {
      merged.push(item);
      return merged;
    }
    last.end = Math.max(last.end, item.end);
    return merged;
  }, []);
}

function extractKeywords(diaries: Diary[]) {
  const text = diaries
    .flatMap((diary) => [
      isTornDiary(diary) ? "" : diary.text,
      ...diary.followUps.map((followup) => followup.text),
      ...diary.comments.map((note) => note.text),
    ])
    .join(" ");
  const counts = new Map<string, number>();

  text.match(/[\u4e00-\u9fff]+|[a-zA-Z0-9]+/g)?.forEach((part) => {
    if (/^[a-zA-Z0-9]+$/.test(part)) {
      const word = part.toLowerCase();
      if (word.length > 1 && !keywordStopWords.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
      return;
    }

    for (let index = 0; index < part.length - 1; index += 1) {
      const word = part.slice(index, index + 2);
      if (!keywordStopWords.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  });

  const words = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-Hans-CN"))
    .slice(0, 4)
    .map(([word]) => word);

  return words.length ? words.join("、") : "还没有明显重复的小词。";
}

const keywordStopWords = new Set([
  "我们",
  "你们",
  "他们",
  "自己",
  "一个",
  "一些",
  "一点",
  "这个",
  "那个",
  "这里",
  "那里",
  "什么",
  "怎么",
  "还是",
  "就是",
  "只是",
  "但是",
  "然后",
  "因为",
  "所以",
  "如果",
  "没有",
  "不是",
  "可以",
  "觉得",
  "感觉",
  "好像",
  "有点",
  "真的",
  "一下",
  "the",
  "and",
  "for",
  "you",
  "are",
  "was",
  "with",
  "this",
  "that",
]);

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) return String((error as { message: unknown }).message);
  return String(error);
}

export default App;
