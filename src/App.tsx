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

type Status = "开心" | "普通" | "有点累" | "卡住了" | "想聊天" | "需要安静";
type Tab = "feed" | "write" | "friends" | "week";
type Composer = "stamp" | "note" | "follow" | null;

type Profile = {
  id: string;
  display_name: string;
  avatar_initial: string;
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
  time: string;
  text: string;
  status?: Status | null;
  responses: { by: string; text: string }[];
  comments: { by: string; text: string; time: string }[];
  followUps: { by: string; text: string; time: string }[];
  highlights: HighlightRange[];
  createdAt: string;
};

type HighlightRange = {
  id: string;
  start: number;
  end: number;
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

const statusOptions: Status[] = ["开心", "普通", "有点累", "卡住了", "想聊天", "需要安静"];
const promptOptions = ["碎碎念", "报个平安", "有点堵", "小进展", "想被听见"];
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        .select("user_id, role, profiles(id,display_name,avatar_initial)")
        .eq("notebook_id", notebook.id)
        .order("joined_at", { ascending: true });
      if (membersError) throw membersError;

      const nextMembers: Member[] = ((memberRows ?? []) as any[]).map((row) => ({
        user_id: row.user_id,
        role: row.role,
        profile: row.profiles,
      }));
      setMembers(nextMembers);
      setSelectedPersonId((current) => current ?? nextMembers[0]?.user_id ?? null);

      const { data: entryRows, error: entriesError } = await supabase
        .from("diary_entries")
        .select("id,notebook_id,author_id,content,mood,created_at,updated_at")
        .eq("notebook_id", notebook.id)
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

      const profileNames = new Map(nextMembers.map((member) => [member.user_id, member.profile.display_name]));
      const nextDiaries: Diary[] = entries.map((entry: any) => ({
        id: entry.id,
        authorId: entry.author_id,
        time: formatTime(entry.created_at),
        text: entry.content,
        status: isStatus(entry.mood) ? entry.mood : null,
        createdAt: entry.created_at,
        responses: stamps
          .filter((stamp: any) => stamp.diary_id === entry.id)
          .map((stamp: any) => ({ by: profileNames.get(stamp.author_id) ?? "朋友", text: stamp.stamp_type })),
        comments: paperNotes
          .filter((note: any) => note.diary_id === entry.id)
          .map((note: any) => ({ by: profileNames.get(note.author_id) ?? "朋友", text: note.content, time: formatTime(note.created_at) })),
        followUps: followups
          .filter((followup: any) => followup.diary_id === entry.id)
          .map((followup: any) => ({ by: profileNames.get(followup.author_id) ?? "朋友", text: followup.content, time: formatTime(followup.created_at) })),
        highlights: highlights
          .filter((highlight: any) => highlight.diary_id === entry.id)
          .map((highlight: any) => ({ id: highlight.id, start: highlight.start_index, end: highlight.end_index })),
      }));

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

  async function addDiary(text: string, mood: Status | null) {
    if (!supabase || !activeNotebook || !session?.user) return;
    const { error: insertError } = await supabase.from("diary_entries").insert({
      notebook_id: activeNotebook.id,
      author_id: session.user.id,
      content: text,
      mood,
    });
    if (insertError) {
      setError(errorMessage(insertError));
      return;
    }
    setTab("feed");
    await loadNotebookData(activeNotebook);
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
    const merged = mergeHighlights(diary?.highlights ?? [], { id: `h${Date.now()}`, start, end });
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

  const selectedMember = members.find((member) => member.user_id === selectedPersonId) ?? members[0] ?? null;
  const selectedMemberDiaries = selectedMember ? diaries.filter((diary) => diary.authorId === selectedMember.user_id) : [];
  const groupedDiaries = groupDiaries(diaries);

  return (
    <div className="app">
      <main className="phone-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">只在 {members.length || 1} 个成员之间</p>
            <h1>{activeNotebook.name}</h1>
          </div>
          <button className="soft-icon" onClick={() => setTab("write")} aria-label="写一笔">
            <PenLine size={20} />
          </button>
        </header>

        {error && <p className="error-note">{error}</p>}

        {tab === "feed" && (
          <section className="notebook-home">
            <div className="notebook-note invite-note">
              <Sparkles size={18} />
              <span>邀请码：{activeNotebook.invite_code}</span>
              <button onClick={() => navigator.clipboard?.writeText(activeNotebook.invite_code)}>复制</button>
            </div>
            <div className="member-strip">
              {members.map((member) => (
                <button
                  key={member.user_id}
                  className="member-pill"
                  onClick={() => {
                    setSelectedPersonId(member.user_id);
                    setTab("friends");
                  }}
                >
                  <span className="avatar">{member.profile.avatar_initial}</span>
                  <span>
                    <strong>{member.profile.display_name}</strong>
                    <small>{member.role === "owner" ? "创建者" : "成员"}</small>
                  </span>
                </button>
              ))}
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
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === "write" && <WriteView onSubmit={addDiary} />}

        {tab === "friends" && (
          <section className="stack">
            <div className="friend-switch">
              {members.map((member) => (
                <button key={member.user_id} className={member.user_id === selectedPersonId ? "active" : ""} onClick={() => setSelectedPersonId(member.user_id)}>
                  {member.profile.display_name}
                </button>
              ))}
            </div>
            {selectedMember && (
              <article className="profile-panel">
                <span className="avatar large">{selectedMember.profile.avatar_initial}</span>
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
}) {
  const [composer, setComposer] = useState<Composer>(null);
  const [openNote, setOpenNote] = useState<number | null>(null);
  const [noteText, setNoteText] = useState("");
  const [followText, setFollowText] = useState("");
  const [highlightBubble, setHighlightBubble] = useState<HighlightBubble>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const isAuthor = diary.authorId === currentUserId;

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
    <article className={`diary-entry ${expanded ? "is-expanded" : ""}`}>
      <div className="diary-head">
        <button className="person-link" onClick={onPerson}>
          <strong>{author.profile.display_name}</strong>
          <small>{diary.time} 写下</small>
        </button>
        {diary.status && <span className={`status ${statusClass(diary.status)}`}>今天像：{diary.status}</span>}
      </div>

      <div className="diary-body">
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
            <span>后来又写：</span>{item.text}
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
                    style={{ "--tilt": `${index % 2 === 0 ? -2 : 2}deg`, "--lift": `${index * -7}px` } as React.CSSProperties}
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
    </article>
  );
}

function AuthPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
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
              options: { data: { display_name: displayName || email.split("@")[0] } },
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
              <label className="field-label">
                你想被怎么称呼
                <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="比如：阿树" />
              </label>
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

function WriteView({ onSubmit }: { onSubmit: (text: string, mood: Status | null) => void }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    onSubmit(text.trim(), status);
    setText("");
    setStatus(null);
  }

  return (
    <section className="write-view">
      <p className="eyebrow">不用组织得很好</p>
      <h2>今天有什么小事想放下来？</h2>
      <div className="prompt-strip">
        {promptOptions.map((prompt) => (
          <button type="button" key={prompt} onClick={() => setText((value) => value || `${prompt}：`)}>
            {prompt}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="write-form">
        <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="有什么不值得专门发消息，但想让他们知道？" />
        <p className="writing-hint">今天的你大概是什么天气？可以不选。</p>
        <div className="status-grid">
          {statusOptions.map((option) => (
            <button type="button" key={option} className={status === option ? "selected" : ""} onClick={() => setStatus(status === option ? null : option)}>
              {option}
            </button>
          ))}
        </div>
        <button className="publish-button">写进本子</button>
      </form>
    </section>
  );
}

function WeekView({ diaries, members }: { diaries: Diary[]; members: Member[] }) {
  if (diaries.length < 2) {
    return <EmptyState title="这一周还没留下太多字" text="多写几笔之后，这里会轻轻收拢大家的近况。" />;
  }

  const activeAuthors = [...new Set(diaries.map((diary) => memberFor(members, diary.authorId).profile.display_name))];
  const tiredCount = diaries.filter((diary) => diary.status === "有点累" || diary.status === "卡住了").length;

  return (
    <section className="week-view stack">
      <article className="week-hero">
        <HeartHandshake size={28} />
        <div>
          <p className="eyebrow">翻到这一周</p>
          <h2>大家都还在慢慢往前走</h2>
        </div>
      </article>
      <div className="summary-grid">
        <Summary title="这周谁写过" text={activeAuthors.join("、")} />
        <Summary title="留下了多少字" text={`${diaries.length} 条日记被放进本子里。`} />
        <Summary title="需要被照看的状态" text={tiredCount ? `有 ${tiredCount} 条日记提到累或卡住。` : "这周没有太多沉重的状态。"} />
        <Summary title="这周的小词" text={extractKeywords(diaries)} />
      </div>
    </section>
  );
}

function Summary({ title, text }: { title: string; text: string }) {
  return (
    <article className="summary-card">
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}

function StampTrail({ stamps }: { stamps: { by: string; text: string }[] }) {
  return (
    <div className="stamp-trail" aria-label="已盖的小印章">
      {stamps.map((stamp, index) => {
        const option = stampOptions.find((item) => item.name === stamp.text) ?? stampOptions[4];
        const Icon = option.icon;
        return (
          <span className={`stamp-mark stamp-${option.name}`} key={`${stamp.by}-${stamp.text}-${index}`}>
            <Icon size={15} />
            <small>{stamp.by} · {option.name === "读到了" ? "读到" : option.name}</small>
          </span>
        );
      })}
    </div>
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
      <span className={`hand-highlight highlight-variant-${index % 3}`} key={highlight.id}>
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
  const profile = {
    id: user.id,
    display_name: displayName,
    avatar_initial: displayName.slice(0, 1) || "友",
  };
  const { data, error } = await supabase.from("profiles").upsert(profile).select("id,display_name,avatar_initial").single();
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
    profile: { id, display_name: "朋友", avatar_initial: "友" },
  };
}

function groupDiaries(diaries: Diary[]) {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toDateString();
  return [
    { label: "今天", items: diaries.filter((diary) => new Date(diary.createdAt).toDateString() === today) },
    { label: "昨天", items: diaries.filter((diary) => new Date(diary.createdAt).toDateString() === yesterday) },
    { label: "这周早些时候", items: diaries.filter((diary) => ![today, yesterday].includes(new Date(diary.createdAt).toDateString())) },
  ].filter((group) => group.items.length > 0);
}

function formatTime(value: string) {
  const date = new Date(value);
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toDateString();
  const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === today) return `今天 ${time}`;
  if (date.toDateString() === yesterday) return `昨天 ${time}`;
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" }) + ` ${time}`;
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
  const text = diaries.map((diary) => diary.text).join("");
  const words = ["今天", "一点", "朋友", "晚上", "最近", "舒服", "慢慢", "本子"].filter((word) => text.includes(word));
  return words.length ? words.join("、") : "还没有明显重复的小词。";
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) return String((error as { message: unknown }).message);
  return String(error);
}

export default App;
