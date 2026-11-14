  // ============================================================
  // ヨコトキ  アプリ本体
  //   1. 設定・Supabase接続
  //   2. 純粋なロジック(画面にも通信にも触れない。tests/unit.test.js で検査している)
  //   3. 状態(メモリ上に持つ値)
  //   4. ログイン
  //   5. 一覧画面
  //   6. 問題画面(読み込み / バケツ / 固定バー / カード / 吹き出し / 判定)
  //   7. 起動
  // ============================================================

  // ── 1. 設定・Supabase接続 ───────────────────────────
  // Supabaseダッシュボード > Project Settings > API から取得して置き換える
  const SUPABASE_URL = 'https://alrieisjlvvmlsocnjxw.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_YfXmxy7iZ_6B8mMRU2H39w_ky7HuS3N';
  const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // 有料テーマのロック画面から飛ぶ、noteの記事のURL(公開前に、本物のURLへ置き換える)
  const NOTE_ARTICLE_URL = 'https://note.com/YOUR_ARTICLE_URL';
  // 「間違いの報告」フォーム(Googleフォーム)。URLを空にすると、報告のリンクは出ない。
  // entry.数字 は、フォームの「⋮ > 事前入力したURLを取得」で作ったURLにある、質問ごとの番号
  const REPORT_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSe22JVe5J4cXIhJT4IPxh3skRX_vM41Zfq_5QXwUvhgLDojjA/viewform';
  const REPORT_FORM_ENTRY_THEME_NAME = 'entry.1676490368';
  const REPORT_FORM_ENTRY_THEME_ID = 'entry.369983301';
  // シャッフル設定を、ブラウザに覚えさせるときの名前
  const SHUFFLE_STORAGE_KEY = 'yokotoki_shuffle_buckets';

  const $ = id => document.getElementById(id);

  // ── 2. 純粋なロジック ───────────────────────────────
  // 画面にも通信にも触れない関数は、pure.js に置いてある(先に読み込まれる。tests/unit.test.js が単体で検査している)。
  //   shuffleArray / getRounds / getThemeComparator / formatLastAnsweredAt / getBucketBarColumns /
  //   sameCardText / judgeAnswer / parseSearchKeywords / formatSearchHit / splitMemoLinks / buildReportUrl

  // ── 3. 状態(メモリ上に持つ値) ──────────────────────
  // ログイン中のユーザー。undefined = まだ確認していない / null = 未ログイン
  let currentUser = undefined;
  let lastKnownUserId = undefined; // ログイン状態の変化の検出用(undefined = まだ一度も確認していない)

  // 一覧画面
  let themeSequence = [];            // 全カテゴリを横断した「カテゴリ順→テーマ順」の一覧(ブックマーク・履歴を含む)
  let categoryList = [];             // カテゴリのプルダウン用一覧
  let currentListFilter = 'all';     // 'all' | 'bookmark' | 'memo'
  let sortMode = 'none';             // 'none' | 'accuracy'(正答率が低い順) | 'lastAnswered'(最終回答日が古い順) | 'attempts'(周回数が少ない順)
  let isPremiumUser = false;         // 有料テーマにロックアイコンを出すかの判定に使う
  let searchHits = null;             // 検索の結果。null = 検索していない / Map(テーマID → ヒットの内訳)
  let searchKeywords = [];           // いま表示している検索結果の、キーワード
  let searchMessage = '';            // 検索中・失敗・入力のしかたの案内(結果が出ているときは、空)
  let searchSeq = 0;                 // 検索のたびに増やす番号(遅れて届いた古い結果を、捨てるため)
  let searchTimer = null;

  // 問題画面
  let currentThemeId = null;
  let currentQuestions = [];         // 表示中のカード(タップのたびに再取得しないよう、メモリに保持)
  let currentBuckets = [];           // 表示中のバケツ(登録順。シャッフルし直すときに、通信せずに使う)
  let currentThemeShuffleAllowed = false; // 今のテーマが、DB側でシャッフルを許可されているか(themes.shuffle_buckets)
  let sortedIds = new Set();         // 仕分け済みのカードID
  let selectedQuestionId = null;
  let selectedCardEl = null;
  let selectedBucketId = null;
  let selectedBucketEl = null;
  let openBubbleQuestionId = null;   // 今、吹き出しを開いている、カードのquestion_id
  let bucketBarObserver = null;      // 固定バーを出すかの判定に使う、バケツ名の可視判定
  let bucketTitleVisible = {};       // バケツID → バケツ名(タイトル)が、画面内に完全に見えているか

  // テーマごとのメモ
  let memoThemeId = null;            // いま、メモを表示しているテーマ(null = メモを出していない)
  let memoSaved = '';                // サーバーに保存されている(または、読み込んだ)内容
  let memoValue = '';                // いまの内容(入力中のものを含む)
  let memoOpen = false;              // メモ欄を開いているか(画面を移ると、閉じる)
  let memoFocused = false;           // メモの入力欄に、カーソルがあるか
  let memoBlurTimer = null;          // カーソルが外れてから、画面下のバーを出すまでの、ごく短い待ち(下の説明を参照)
  let memoTextareaInView = false;    // メモの入力欄が、画面内に見えているか
  let memoDeleting = false;          // 「削除しますか?」の確認を出しているか
  let memoEditing = false;           // 編集中か(false = 閲覧。URLがリンクで出る)
  let memoLoggedIn = false;
  let memoQueuedValue = null;        // 保存を依頼済み(まだ完了していない場合を含む)の内容。同じ内容を、二重に保存しないため
  let memoLoadFailed = false;        // 読み込みに失敗したとき、編集させない(空のまま上書きして、元のメモを消さないため)
  let memoSaveTimer = null;
  let memoSaveChain = Promise.resolve(); // 保存を、順番に1つずつ行うための鎖

  // 問題画面での「次へ・ランダム」の対象範囲(一覧画面での絞り込みを、テーマを開いたときに引き継ぐ)
  let activeThemeCategoryId = '';
  let activeThemeBookmarkOnly = false;
  let activeThemeMemoOnly = false;
  let activeThemeSearchIds = null;   // 検索でヒットしていたテーマのID(Set)。null = 検索していない
  let activeThemeSortMode = 'none';

  // 閲覧モード(最初から全カード仕分け済みの状態で表示。記録は保存しない)
  let isViewMode = false;
  // バケツの位置をシャッフルするか。ユーザーが選んだ設定は、アプリ全体で共通の1つの設定として、ブラウザに覚えさせる
  let isShuffleEnabled = localStorage.getItem(SHUFFLE_STORAGE_KEY) === 'true';

  // ── 4. ログイン ─────────────────────────────────
  // ログイン中のユーザーを返す。通信のたびに確認せず、一度確認した結果を使い回す
  // (ログイン・ログアウトの変化は、下の onAuthStateChange が反映する)
  async function getCurrentUser() {
    if (currentUser === undefined) {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (currentUser === undefined) currentUser = session?.user || null;
    }
    return currentUser;
  }

  // 課金状態(entitlements)を確認して、isPremiumUserに反映する
  async function fetchPremiumStatus(user) {
    if (!user) {
      isPremiumUser = false;
      return false;
    }
    const { data } = await supabaseClient
      .from('entitlements')
      .select('is_premium')
      .eq('user_id', user.id)
      .maybeSingle();
    isPremiumUser = data?.is_premium || false;
    return isPremiumUser;
  }

  // Googleログイン(OAuth)の直後、URLの#以降に、アクセストークンなどの機密情報が、
  // そのまま残ってしまう。これを、履歴に残さない形で消す(URLのまま共有・ブックマークされる危険があるため)
  function clearAuthTokenFromUrl() {
    if (window.location.hash && window.location.hash.includes('access_token')) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  function renderAuthArea(user) {
    const el = $('auth-area');
    if (user) {
      el.innerHTML = `<p class="auth-status">✓ ログイン中 <button class="auth-link-btn" id="logout-btn">ログアウト</button></p>`;
      $('logout-btn').addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
      });
    } else {
      el.innerHTML = `
        <button class="google-login-btn" id="google-login-btn">
          <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.9 2.4 30.4 0 24 0 14.6 0 6.5 5.4 2.5 13.2l7.8 6.1C12.2 13 17.6 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.5 3-2.2 5.4-4.7 7.1l7.4 5.7c4.3-4 6.8-9.9 6.8-17.3z"/><path fill="#FBBC05" d="M10.3 19.3A14.5 14.5 0 0 0 9.5 24c0 1.6.3 3.3.8 4.7l-7.8 6.1A24 24 0 0 1 0 24c0-3.9.9-7.6 2.5-10.8l7.8 6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.4 0-11.8-3.5-13.7-9.7l-7.8 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
          Googleでログイン
        </button>
      `;
      $('google-login-btn').addEventListener('click', async () => {
        await supabaseClient.auth.signInWithOAuth({ provider: 'google' });
      });
    }
  }

  // ログイン・ログアウトのたびに、表示中のテーマと一覧の進捗を読み込み直す。
  // ただし、Supabaseの仕様上、タブを非アクティブ→アクティブに戻しただけでも、
  // 同じユーザーのまま、このコールバックが再度呼ばれることがある(トークンの自動確認のため)。
  // その場合まで、テーマを読み込み直すと、タブを切り替えるたびにリロードされたように見えてしまうため、
  // ユーザーIDが実際に変わったときだけ反応する。
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    clearAuthTokenFromUrl();

    currentUser = session?.user || null;
    renderAuthArea(currentUser);
    const userId = currentUser?.id || null;
    if (userId === lastKnownUserId) return; // 前回と同じユーザーのままなら、何もしない
    lastKnownUserId = userId;

    // 問題画面を開いているときだけ、テーマを読み込み直す(一覧画面では、次に開くときに読み込まれる。
    // 一覧画面で読み込むと、見えていない問題画面のバーが、一覧の上に出てしまう)
    if (currentThemeId && !$('practice-view').hidden) loadTheme(currentThemeId);
    loadUserProgress().then(() => {
      if ($('list-view').hidden === false) applyListFilter();
    });
  });

  // onAuthStateChangeの中だけでチェックすると、イベントの発火と、URLへのハッシュの反映に、
  // タイミングのズレ(レースコンディション)があり、見逃すことが、Supabase側でも報告されている。
  // そのため、独立して、短い間隔で繰り返し確認する(Supabaseがトークンを読み取り終えるまでの猶予も、これで確保できる)
  function startAuthTokenCleanup() {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      clearAuthTokenFromUrl();
      if (attempts >= 20) clearInterval(timer); // 最大10秒間(500ms×20回)だけ確認する
    }, 500);
  }

  // ── 5. 一覧画面 ──────────────────────────────────
  // お知らせ: is_active = trueの行があれば、画面上部に表示する。文言はTable Editorから編集する。
  async function loadAnnouncement() {
    const el = $('announcement');
    const { data, error } = await supabaseClient
      .from('announcements')
      .select('message')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error('お知らせ取得エラー:', error);
      return;
    }
    if (data) {
      el.textContent = data.message;
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }

  async function buildThemeSequence() {
    const [
      { data: categories, error: catErr },
      { data: themes, error: themeErr },
      { data: questionCounts, error: countErr }
    ] = await Promise.all([
      supabaseClient.from('categories').select('*').order('sort_order'),
      supabaseClient.from('themes').select('*').order('sort_order'),
      supabaseClient.from('theme_question_counts').select('theme_id, question_count')
    ]);
    if (catErr) console.error('categories取得エラー:', catErr);
    if (themeErr) console.error('themes取得エラー:', themeErr);
    // カード枚数のVIEWが未作成でも、並べ替え以外は動くようにする(周回数は回答回数で代用される)
    if (countErr) console.warn('カード枚数の取得に失敗しました(回答回数で代用します):', countErr.message);
    const questionCountById = {};
    (questionCounts || []).forEach(r => { questionCountById[r.theme_id] = r.question_count; });
    categoryList = categories || [];
    themeSequence = [];
    categoryList.forEach(c => {
      (themes || [])
        .filter(t => t.category_id === c.id)
        .forEach(t => themeSequence.push({
          ...t,
          categoryName: c.name,
          isFreeTheme: !!c.is_free || !!t.is_free,   // 無料で読める(カテゴリが無料、または、このテーマだけ無料)
          isTrial: !c.is_free && !!t.is_free,        // 有料カテゴリの中の、無料のお試しテーマ
          isBookmarked: false,
          hasMemo: false,
          accuracy: null,
          attemptCount: 0,
          lastAnsweredAt: null,
          questionCount: questionCountById[t.id] || 0
        }));
    });
    await loadUserProgress();
  }

  // テーマ単位のブックマーク・正答率・課金状態を取得して themeSequence に反映する
  async function loadUserProgress() {
    const user = await getCurrentUser();
    if (!user) {
      isPremiumUser = false;
      // ログアウト時、前のユーザーの進捗情報が画面に残らないよう、明示的にリセットする
      themeSequence.forEach(t => {
        t.isBookmarked = false;
        t.hasMemo = false;
        t.accuracy = null;
        t.attemptCount = 0;
        t.lastAnsweredAt = null;
      });
      return;
    }
    if (!themeSequence.length) return;

    const [
      { data: bookmarks, error: bookmarkErr },
      { data: accuracyRows, error: accuracyErr },
      { data: noteRows, error: noteErr }
    ] = await Promise.all([
      supabaseClient.from('user_bookmarks').select('theme_id').eq('user_id', user.id),
      supabaseClient.from('user_theme_accuracy').select('theme_id, total, correct, last_answered_at').eq('user_id', user.id),
      supabaseClient.from('user_theme_notes').select('theme_id').eq('user_id', user.id),   // メモがあるテーマ(中身は、取らない)
      fetchPremiumStatus(user)
    ]);
    if (bookmarkErr) console.error('ブックマーク取得エラー:', bookmarkErr);
    if (accuracyErr) console.error('正答率取得エラー:', accuracyErr);
    if (noteErr) console.error('メモ一覧の取得エラー:', noteErr);

    const bookmarkedThemeIds = new Set((bookmarks || []).map(b => b.theme_id));
    const memoThemeIds = new Set((noteRows || []).map(r => r.theme_id));
    const statsById = {};
    (accuracyRows || []).forEach(row => { statsById[row.theme_id] = row; });

    themeSequence.forEach(t => {
      const stats = statsById[t.id];
      const total = stats?.total || 0;
      const correct = stats?.correct || 0;
      t.isBookmarked = bookmarkedThemeIds.has(t.id);
      t.hasMemo = memoThemeIds.has(t.id);
      t.attemptCount = total;
      t.accuracy = total > 0 ? correct / total : null; // 未挑戦はnull
      t.lastAnsweredAt = stats?.last_answered_at || null; // 未挑戦はnull
    });
  }

  async function ensureThemeSequence() {
    if (!themeSequence.length) await buildThemeSequence();
    return themeSequence.length > 0;
  }

  async function initListView() {
    await buildThemeSequence();
    populateFilterSelectors();
    renderThemeList('');
  }

  function populateFilterSelectors() {
    const catSel = $('filter-category-select');
    catSel.innerHTML = '<option value="">すべてのカテゴリ</option>';
    categoryList.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      catSel.appendChild(opt);
    });
  }

  function applyListFilter() {
    renderThemeList($('filter-category-select').value);
  }

  // 一覧に出すテーマ(カテゴリ・ブックマーク/メモあり・検索の、絞り込みを、すべて満たすもの)
  function getFilteredThemes(categoryId) {
    return themeSequence.filter(t => {
      if (categoryId && t.category_id !== categoryId) return false;
      if (searchHits && !searchHits.has(t.id)) return false;
      if (currentListFilter === 'bookmark') return t.isBookmarked;
      if (currentListFilter === 'memo') return t.hasMemo;
      return true;
    });
  }

  function renderThemeList(categoryId) {
    const el = $('theme-list');
    el.innerHTML = '';
    const filtered = getFilteredThemes(categoryId);
    updateSearchStatus(filtered.length);

    if (!filtered.length) {
      el.innerHTML = '<p class="list-empty">該当するテーマが見つかりません</p>';
      return;
    }

    // 「すべてのカテゴリ」で、かつ並べ替え中は、カテゴリの区切りを取り払い、
    // 横断的な1つの順番で表示する(「次へ」の挙動と一致させるため)
    const isCrossCategorySort = !categoryId && sortMode !== 'none';

    if (isCrossCategorySort) {
      filtered.slice().sort(getThemeComparator(sortMode)).forEach(t => el.appendChild(buildThemeLink(t)));
      return;
    }

    const groups = [];
    filtered.forEach(t => {
      let group = groups.find(g => g.categoryName === t.categoryName);
      if (!group) {
        group = { categoryName: t.categoryName, themes: [] };
        groups.push(group);
      }
      group.themes.push(t);
    });

    if (sortMode !== 'none') {
      // カテゴリの区切りは保ったまま、各カテゴリの中だけ並べ替える(未挑戦は先頭)
      groups.forEach(g => g.themes.sort(getThemeComparator(sortMode)));
    }

    groups.forEach(g => {
      const section = document.createElement('div');
      section.className = 'category-group';

      const heading = document.createElement('h2');
      heading.className = 'category-heading';
      heading.textContent = g.categoryName;
      section.appendChild(heading);

      g.themes.forEach(t => section.appendChild(buildThemeLink(t)));
      el.appendChild(section);
    });
  }

  // 要素を作って、クラスと文字(textContent)を入れる。名前などに記号が入っても、そのまま表示される
  function makeEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function buildThemeLink(t) {
    let rightText;
    if (sortMode === 'lastAnswered') {
      rightText = formatLastAnsweredAt(t.lastAnsweredAt);
    } else if (sortMode === 'attempts') {
      if (!t.attemptCount) rightText = '未挑戦';
      else rightText = t.questionCount > 0 ? `${getRounds(t).toFixed(1)}回` : `${t.attemptCount}回回答`;
    } else {
      rightText = t.accuracy === null ? '未挑戦' : `正答率 ${Math.round(t.accuracy * 100)}%`;
    }

    const link = makeEl('a', 'theme-link');
    link.href = '#';
    const hit = searchHits && searchHits.get(t.id);

    const main = makeEl('span', 'theme-link-main');
    const star = makeEl('span', 'theme-link-star' + (t.isBookmarked ? ' active' : ''), t.isBookmarked ? '★' : '☆');
    main.append(star, makeEl('span', '', t.title));
    if (t.hasMemo) {
      const memoIcon = makeEl('span', 'theme-link-memo', '📝');
      memoIcon.title = 'メモあり';
      memoIcon.setAttribute('aria-label', 'メモあり');
      main.appendChild(memoIcon);
    }
    // 有料のテーマで、まだ購入していないユーザーには、鍵アイコンを表示する
    // (有料カテゴリの中の、無料のお試しテーマには、鍵ではなく「無料」の印を付ける)
    if (!t.isFreeTheme && !isPremiumUser) {
      const lock = makeEl('span', 'theme-link-lock', '🔒');
      lock.title = '有料テーマ';
      main.appendChild(lock);
    } else if (t.isTrial && !isPremiumUser) {
      const tag = makeEl('span', 'theme-link-free', '無料');
      tag.title = 'お試しで、無料で使えるテーマ';
      main.appendChild(tag);
    }

    const right = makeEl('span', 'theme-link-right');
    right.append(makeEl('span', 'theme-link-accuracy', rightText), makeEl('span', 'theme-link-arrow', '→'));
    link.append(main, right);
    if (hit) {
      link.classList.add('has-hit');
      link.appendChild(makeEl('span', 'theme-link-hit', formatSearchHit(hit)));
    }

    star.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      toggleThemeBookmark(t);
    });
    link.addEventListener('click', e => {
      e.preventDefault();
      openTheme(t.id);
    });
    return link;
  }

  // ── 検索 ──
  // 検索は「一覧の絞り込み」の1つ。カテゴリ・ブックマーク・並べ替えと、そのまま組み合わせられる。
  // 実際の検索は、DBの関数 search_themes(migration-search.sql)が行う(権限もそちらで効く)。
  function updateSearchStatus(visibleCount) {
    const el = $('search-status');
    let text = searchMessage;
    if (!text && searchHits) {
      text = `「${searchKeywords.join(' ')}」: ${visibleCount}件のテーマがヒット`;
      // 未購入の人には、有料のカード・解説は、DBの権限で見えない(ヒットしないのは、そのため)
      if (!isPremiumUser) text += '\n有料テーマのカード・解説の本文は、購入後に検索できます。';
    }
    el.textContent = text;
    el.hidden = !text;
  }

  function clearSearch() {
    searchSeq++;
    searchHits = null;
    searchKeywords = [];
    searchMessage = '';
    applyListFilter();
  }

  async function runSearch() {
    const text = $('search-input').value;
    if (!text.trim()) { clearSearch(); return; }

    const seq = ++searchSeq;
    const keywords = parseSearchKeywords(text);
    if (!keywords.length) {
      // 入力はあるが、検索できる語がない(1文字だけ、など)。一覧は、絞り込まない
      searchHits = null;
      searchMessage = '2文字以上のキーワードを入力してください';
      applyListFilter();
      return;
    }

    searchMessage = '検索中…';
    updateSearchStatus(0);
    const { data, error } = await supabaseClient.rpc('search_themes', { keywords });
    if (seq !== searchSeq) return; // もっと新しい検索が始まっているので、この結果は捨てる

    if (error) {
      console.error('検索エラー:', error);
      searchHits = null;
      searchMessage = '検索に失敗しました。時間をおいて、もう一度お試しください';
    } else {
      searchHits = new Map((data || []).map(r => [r.theme_id, r]));
      searchKeywords = keywords;
      searchMessage = '';
    }
    applyListFilter();
  }

  function scheduleSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 350);
  }

  function setupSearch() {
    const input = $('search-input');
    // 日本語の入力中(変換の途中)は、検索しない。確定したときに、検索する
    input.addEventListener('input', e => { if (!e.isComposing) scheduleSearch(); });
    input.addEventListener('compositionend', scheduleSearch);
    input.addEventListener('keydown', e => {
      if (e.isComposing) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(searchTimer);
        runSearch();
        input.blur(); // スマホのキーボードを閉じて、結果を見せる
      } else if (e.key === 'Escape') {
        input.value = '';
        clearTimeout(searchTimer);
        clearSearch();
      }
    });
  }

  // ログイン済みユーザーのみブックマークをSupabaseに永続化する
  async function toggleThemeBookmark(theme) {
    const user = await getCurrentUser();
    if (!user) return; // 未ログイン時は何もしない(今後ログイン導線を追加)

    theme.isBookmarked = !theme.isBookmarked;
    if (theme.isBookmarked) {
      await supabaseClient.from('user_bookmarks').insert({ user_id: user.id, theme_id: theme.id });
    } else {
      await supabaseClient.from('user_bookmarks').delete().eq('user_id', user.id).eq('theme_id', theme.id);
    }
    applyListFilter();
  }

  // 問題画面上部のブックマークボタンの表示
  function updateBookmarkButton() {
    const theme = themeSequence.find(t => t.id === currentThemeId);
    const btn = $('theme-bookmark-btn');
    if (!theme) return;
    btn.textContent = theme.isBookmarked ? '★ ブックマーク済み' : '☆ このテーマをブックマーク';
    btn.classList.toggle('active', theme.isBookmarked);
  }

  async function toggleCurrentThemeBookmark() {
    const theme = themeSequence.find(t => t.id === currentThemeId);
    if (!theme) return;
    await toggleThemeBookmark(theme);
    updateBookmarkButton();
  }

  // このテーマの解答履歴(正答率のもと)を丸ごと削除する。元に戻せないため確認を挟む
  async function resetThemeProgress() {
    const user = await getCurrentUser();
    if (!user) {
      alert('ログインしていないため、リセットする記録がありません。');
      return;
    }
    if (!confirm('このテーマの正答率・解答履歴をリセットします。元に戻せませんが、よろしいですか？')) return;

    await supabaseClient
      .from('user_answer_logs')
      .delete()
      .eq('user_id', user.id)
      .eq('theme_id', currentThemeId);

    const theme = themeSequence.find(t => t.id === currentThemeId);
    if (theme) {
      theme.accuracy = null;
      theme.attemptCount = 0;
      theme.lastAnsweredAt = null;
    }

    // 今の画面上の状態(バケツに置いたカードなど)も合わせてリセットする。
    // 閲覧モードは、最初から全カードが仕分け済みの表示で、リセットする画面上の状態がないので、そのまま
    if (!isViewMode) {
      sortedIds = new Set();
      clearCardSelection();
      clearBucketSelection();
      closeExplanationBubble();
      document.querySelectorAll('.bucket-cards').forEach(el => { el.innerHTML = ''; });
      renderDeck();
    }

    alert('リセットしました。');
  }

  // 並べ替えボタン(押すと、そのモードに切り替わり、もう一度押すと、テーマ順に戻る)
  const SORT_BUTTONS = [
    { id: 'sort-toggle-btn',    mode: 'accuracy',     label: '正答率が低い順に並べ替え' },
    { id: 'sort-by-date-btn',   mode: 'lastAnswered', label: '最終回答日が古い順に並べ替え' },
    { id: 'sort-by-count-btn',  mode: 'attempts',     label: '回答回数が少ない順に並べ替え' }
  ];

  function updateSortButtons() {
    SORT_BUTTONS.forEach(({ id, mode, label }) => {
      const btn = $(id);
      btn.classList.toggle('active', sortMode === mode);
      btn.textContent = sortMode === mode ? 'テーマ順に戻す' : label;
    });
  }

  function setupListFilters() {
    document.querySelectorAll('.list-filters .filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentListFilter = btn.dataset.filter;
        document.querySelectorAll('.list-filters .filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applyListFilter();
      });
    });

    SORT_BUTTONS.forEach(({ id, mode }) => {
      $(id).addEventListener('click', () => {
        sortMode = sortMode === mode ? 'none' : mode;
        updateSortButtons();
        applyListFilter();
      });
    });
  }

  // 閲覧/仕分けのバッジ。一覧画面側のバッジは「次にテーマを開くときの初期モード」を表す
  function updateModeBadges() {
    ['mode-badge', 'list-mode-badge'].forEach(id => {
      const badge = $(id);
      badge.textContent = isViewMode ? '👁 閲覧中' : '✏️ 仕分け中';
      badge.classList.toggle('view', isViewMode);
    });
  }

  // シャッフルの、オン・オフに応じて、ボタンの見た目を更新する(一覧画面と問題画面の、両方)
  function updateShuffleToggleButton() {
    const label = isShuffleEnabled ? '🔀 バケツシャッフルON' : '🔀 バケツシャッフルOFF';
    ['shuffle-toggle-btn', 'list-shuffle-toggle-btn'].forEach(id => {
      const btn = $(id);
      btn.textContent = label;
      btn.classList.toggle('active', isShuffleEnabled);
    });
  }

  function toggleShuffleSetting() {
    isShuffleEnabled = !isShuffleEnabled;
    localStorage.setItem(SHUFFLE_STORAGE_KEY, String(isShuffleEnabled));
    updateShuffleToggleButton();
  }

  function openTheme(themeId) {
    $('list-view').hidden = true;
    $('practice-view').hidden = false;
    updateModeBadges();
    updateShuffleToggleButton();
    // 一覧画面で絞り込んでいたカテゴリ・ブックマーク・検索・並び順を、次へ・ランダムの対象範囲として引き継ぐ
    activeThemeCategoryId = $('filter-category-select').value;
    activeThemeBookmarkOnly = currentListFilter === 'bookmark';
    activeThemeMemoOnly = currentListFilter === 'memo';
    activeThemeSearchIds = searchHits ? new Set(searchHits.keys()) : null;
    activeThemeSortMode = sortMode;
    loadTheme(themeId);
  }

  async function showListView() {
    const savingMemo = flushMemo();   // 書きかけのメモの保存が終わってから、一覧のメモのアイコンを読み直す
    hideMemo();
    hideBucketBar();
    $('practice-view').hidden = true;
    $('list-view').hidden = false;
    // 問題画面で解答した内容(正答率・ブックマーク・メモ)を一覧に反映し直す
    await savingMemo;
    await loadUserProgress();
    applyListFilter();
  }

  // 一覧画面での絞り込み(カテゴリ・ブックマーク/メモあり・検索)を、次へ・ランダムの対象範囲に適用する
  function getActiveThemePool() {
    const pool = themeSequence.filter(t => {
      if (activeThemeCategoryId && t.category_id !== activeThemeCategoryId) return false;
      if (activeThemeBookmarkOnly && !t.isBookmarked) return false;
      if (activeThemeMemoOnly && !t.hasMemo) return false;
      if (activeThemeSearchIds && !activeThemeSearchIds.has(t.id)) return false;
      return true;
    });
    // 一覧画面と同じ基準で並べ替える
    if (activeThemeSortMode !== 'none') pool.sort(getThemeComparator(activeThemeSortMode));
    return pool;
  }

  // 「次のテーマへ」進む(一覧画面での絞り込みを引き継いだ範囲内だけを回る)
  async function goToNextTheme() {
    if (!await ensureThemeSequence()) return;
    const pool = getActiveThemePool();
    if (!pool.length) return;
    const currentIndex = pool.findIndex(t => t.id === currentThemeId);
    loadTheme(pool[(currentIndex + 1) % pool.length].id);
  }

  // 直前と同じテーマは避けつつ、無作為に1つ選ぶ(こちらも絞り込みの範囲内で行う)
  async function goToRandomTheme() {
    if (!await ensureThemeSequence()) return;
    const pool = getActiveThemePool();
    if (!pool.length) return;
    const candidates = pool.length > 1 ? pool.filter(t => t.id !== currentThemeId) : pool;
    loadTheme(candidates[Math.floor(Math.random() * candidates.length)].id);
  }

  // ── 6. 問題画面 ──────────────────────────────────
  // ── 6-1. テーマ(設問)の読み込み ──
  // 間違いの報告のリンク: 内容が見えているテーマ(ロック中ではない)にだけ出す。設定が空・不正なときは出さない
  function updateReportLink(themeName, themeId) {
    const href = buildReportUrl(REPORT_FORM_URL, REPORT_FORM_ENTRY_THEME_NAME, REPORT_FORM_ENTRY_THEME_ID, themeName, themeId);
    $('report-row').hidden = !href;
    if (href) $('report-link').href = href;
  }

  async function loadTheme(themeId) {
    currentThemeId = themeId;
    // 前のテーマのメモは、保存してから切り替える(通信を待つ間に、前回の表示が一瞬残らないよう、真っ先にリセットする)
    flushMemo();
    hideMemo();
    hideBucketBar();
    currentBuckets = [];
    $('buckets').innerHTML = '';
    $('deck').innerHTML = '';
    $('theme-instruction').textContent = '読み込み中...';
    $('theme-breadcrumb').textContent = '';
    $('theme-bookmark-btn').textContent = '☆ このテーマをブックマーク';
    $('theme-bookmark-btn').classList.remove('active');
    $('report-row').hidden = true;

    const user = await getCurrentUser(); // 一度確認していれば、すぐ返る

    // 必要な取得をできるだけまとめて並列で走らせる
    const [
      { data: theme, error: themeErr },
      { data: buckets },
      { data: questions },
      memoResult
    ] = await Promise.all([
      supabaseClient.from('themes').select('*, categories(is_free, name)').eq('id', themeId).single(),
      supabaseClient.from('buckets').select('*').eq('theme_id', themeId).order('sort_order'),
      supabaseClient.from('questions').select('*').eq('theme_id', themeId),
      user
        ? supabaseClient.from('user_theme_notes').select('body').eq('user_id', user.id).eq('theme_id', themeId).maybeSingle()
        : Promise.resolve({ data: null, error: null })
    ]);
    // 待っている間に別のテーマへ切り替わっていたら、この結果は使わずに中断する
    if (themeId !== currentThemeId) return;
    if (themeErr) return console.error(themeErr);

    // 解除コードを入れた直後にも呼ばれるので、課金状態は、ここで確認し直す
    const isPremium = await fetchPremiumStatus(user);
    if (themeId !== currentThemeId) return;

    const isFreeTheme = !!theme.categories?.is_free || !!theme.is_free;   // カテゴリが無料、または、このテーマだけ無料
    const locked = !isFreeTheme && !isPremium;

    // ここまでで必要なデータが全部揃ったので、まとめて画面を更新する
    $('theme-instruction').textContent = theme.instruction;
    $('theme-breadcrumb').textContent = `${theme.categories?.name || ''} › ${theme.title}`;
    updateBookmarkButton();
    updateShuffleToggleButton();

    if (locked) {
      showLockScreen();
      return;
    }
    hideLockScreen();
    showMemo(themeId, user, memoResult);
    updateReportLink(`${theme.categories?.name || ''} › ${theme.title}`, themeId);

    if (isViewMode) {
      // 閲覧モード: シャッフルせず登録順で、最初から全問を仕分け済みとして表示する
      currentQuestions = (questions || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      sortedIds = new Set(currentQuestions.map(q => q.id));
    } else {
      currentQuestions = shuffleArray(questions || []);
      sortedIds = new Set();
    }
    selectedQuestionId = null;
    selectedCardEl = null;
    selectedBucketId = null;
    selectedBucketEl = null;
    closeExplanationBubble();
    // 実際にシャッフルするかは、「ユーザーが、シャッフルを選んでいるか」と、
    // 「そのテーマ自体が、シャッフルに対応しているか(theme.shuffle_buckets)」の、
    // 両方が、trueのときだけ。これにより、条文並べ替えのようなテーマでは、
    // ユーザーが、どう選んでも、位置が固定されたまま、安全に保たれる。
    currentThemeShuffleAllowed = !!theme.shuffle_buckets;
    currentBuckets = buckets || [];
    renderBuckets();
    renderDeck();
  }

  // ロック画面と学習画面の出し分け
  function showLockScreen() {
    hideBucketBar();
    $('buckets').hidden = true;
    $('deck').hidden = true;
    $('lock-screen').hidden = false;
  }
  function hideLockScreen() {
    $('buckets').hidden = false;
    $('deck').hidden = false;
    $('lock-screen').hidden = true;
  }

  // 解除コードの確認
  async function redeemCode() {
    const code = $('redeem-code-input').value.trim();
    const msgEl = $('redeem-message');
    if (!code) return;

    const user = await getCurrentUser();
    msgEl.hidden = false;
    if (!user) {
      msgEl.textContent = '先にログインしてください。';
      return;
    }

    const { data, error } = await supabaseClient.functions.invoke('redeem-code', { body: { code } });
    if (error || data?.error) {
      msgEl.textContent = 'コードが正しくないか、エラーが発生しました。';
    } else {
      msgEl.textContent = '解除しました。反映しています…';
      if (currentThemeId) loadTheme(currentThemeId);
    }
  }

  // ── 6-1b. テーマごとのメモ ──
  // 閲覧では、URLがリンクになって出る。「編集」で、テキスト欄に切り替わり、入力すると、自動で保存される。
  // ログインしている人だけが、書ける(メモは、本人にだけ見える)。テーマを移る・一覧に戻る・画面を離れるときも、保存する。
  function setMemoStatus(text, isError) {
    $('memo-status').textContent = text;
    $('memo-status').parentElement.classList.toggle('error', !!isError);
    $('memo-retry-btn').hidden = !isError || memoLoadFailed;
  }

  // 一覧の「メモあり」のアイコンを、いまの状態に合わせる(一覧に戻ったときに、取りこぼさないため)
  function setThemeHasMemo(themeId, has) {
    const t = themeSequence.find(x => x.id === themeId);
    if (t) t.hasMemo = has;
  }

  // 入力中は画面下の固定バーを隠す(スマホのキーボードと重ならないように)。
  // ただし、入力欄が画面の外へスクロールされたら、バーを出す(カーソルが残っていても、下のバケツを使えるように)
  function updateMemoEditingClass() {
    document.body.classList.toggle('memo-editing', memoFocused && memoTextareaInView);
  }

  function hideMemo() {
    clearTimeout(memoSaveTimer);
    memoThemeId = null;
    memoEditing = false;
    memoDeleting = false;
    memoOpen = false;                // 画面を移るたびに、メモは閉じた状態から始める
    clearTimeout(memoBlurTimer);
    memoFocused = false;
    updateMemoEditingClass();
    $('memo').hidden = true;
  }

  function showMemo(themeId, user, result) {
    memoThemeId = themeId;
    memoLoggedIn = !!user;
    memoLoadFailed = !!(result && result.error);
    memoSaved = (result && result.data && result.data.body) || '';
    if (!memoLoadFailed) setThemeHasMemo(themeId, !!memoSaved);
    memoValue = memoSaved;
    memoQueuedValue = null;
    memoEditing = false;
    memoDeleting = false;
    setMemoStatus('');
    if (memoLoadFailed) console.error('メモ取得エラー:', result.error);
    $('memo').hidden = false;
    renderMemo();
  }

  // 閲覧の表示を、作り直す(URLを、リンクにする。文字は、textContentで入れるので、記号が入っても安全)
  function renderMemoView() {
    const view = $('memo-view');
    view.innerHTML = '';
    view.classList.toggle('empty', !memoValue);
    if (!memoLoggedIn) {
      view.textContent = 'ログインすると自分専用の学習用のメモを残すことができます';
      view.classList.add('empty');
      return;
    }
    if (!memoValue) {
      view.textContent = memoLoadFailed ? '' : 'まだメモはありません。';
      return;
    }
    splitMemoLinks(memoValue).forEach(part => {
      if (part.type === 'text') {
        view.appendChild(document.createTextNode(part.value));
      } else {
        const a = makeEl('a', '', part.value);
        a.href = part.href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        view.appendChild(a);
      }
    });
  }

  function renderMemo() {
    $('memo-toggle').setAttribute('aria-expanded', String(memoOpen));
    $('memo-body').hidden = !memoOpen;
    $('memo-badge').hidden = !memoValue.trim();
    if (!memoOpen) return;

    const canEdit = memoLoggedIn && !memoLoadFailed;
    $('memo-view').hidden = memoEditing;
    $('memo-view-actions').hidden = memoEditing || memoDeleting || !canEdit;
    $('memo-delete-btn').hidden = !memoSaved;   // 削除できるのは、保存済みのメモがあるときだけ
    $('memo-delete-confirm').hidden = !(memoDeleting && canEdit && !memoEditing);
    $('memo-editor').hidden = !memoEditing;
    $('memo-edit-btn').textContent = memoValue ? '✏️ 編集' : '✏️ メモを書く';
    if (memoEditing) {
      updateMemoCount();
    } else {
      renderMemoView();
    }
    if (memoLoadFailed) setMemoStatus('メモを読み込めませんでした。時間をおいて、このテーマを開き直してください。', true);
  }

  function updateMemoCount() {
    $('memo-count').textContent = `${[...$('memo-textarea').value].length} / 5000`;
  }

  function startMemoEdit() {
    if (!memoLoggedIn || memoLoadFailed) return;
    memoEditing = true;
    memoDeleting = false;
    $('memo-textarea').value = memoValue;
    renderMemo();
    $('memo-textarea').focus();
  }

  function finishMemoEdit() {
    memoValue = $('memo-textarea').value;
    // 空のまま「完了」しても、保存済みの内容は消さない(消すときは、「削除」から)
    if (!memoValue.trim()) memoValue = memoSaved;
    memoEditing = false;
    clearTimeout(memoBlurTimer);
    memoFocused = false;
    updateMemoEditingClass();
    saveMemoNow();
    renderMemo();
  }

  // 保存する(入力が止まって少し待ってから)
  function scheduleMemoSave() {
    clearTimeout(memoSaveTimer);
    memoSaveTimer = setTimeout(saveMemoNow, 800);
  }

  // すぐに保存する。保存は、鎖でつないで、順番に1つずつ行う(古い内容が、新しい内容を、上書きしないため)
  // 入力が空(空白・改行だけを含む)のときは、自動では保存も削除もしない。削除は、deleteMemo() だけが行う
  function saveMemoNow(allowDelete) {
    clearTimeout(memoSaveTimer);
    const themeId = memoThemeId;
    const value = memoValue.trim() ? memoValue : '';
    if (!value && allowDelete !== true) {
      if (themeId && memoSaved && memoLoggedIn && !memoLoadFailed) setMemoStatus('空のままでは保存されません。保存済みの内容は残っています(消すときは「削除」)');
      return memoSaveChain;
    }
    if (!themeId || !memoLoggedIn || memoLoadFailed || value === memoSaved || value === memoQueuedValue) return memoSaveChain;
    memoQueuedValue = value;
    memoSaveChain = memoSaveChain.then(() => persistMemo(themeId, value));
    return memoSaveChain;
  }

  // 画面を離れる前などに呼ぶ。編集中の内容を、メモの変数に取り込んでから、保存する
  function flushMemo() {
    if (memoThemeId && memoEditing) memoValue = $('memo-textarea').value;
    return saveMemoNow();
  }

  // 「削除する」を押したときだけ、保存済みのメモを消す
  function deleteMemo() {
    if (!memoThemeId || !memoLoggedIn || memoLoadFailed) return;
    memoDeleting = false;
    memoValue = '';
    memoEditing = false;
    renderMemo();
    return saveMemoNow(true);
  }

  async function persistMemo(themeId, value) {
    const user = await getCurrentUser();
    if (!user) return;
    const stillShown = () => themeId === memoThemeId;
    if (stillShown()) setMemoStatus('保存中…');

    let error;
    if (!value.trim()) {
      // 「削除する」を押したときだけ、行ごと消す(表に、空のメモを残さない)
      ({ error } = await supabaseClient.from('user_theme_notes').delete().eq('user_id', user.id).eq('theme_id', themeId));
    } else {
      ({ error } = await supabaseClient.from('user_theme_notes').upsert(
        { user_id: user.id, theme_id: themeId, body: value },
        { onConflict: 'user_id,theme_id' }
      ));
    }
    if (error) {
      console.error('メモ保存エラー:', error);
      if (memoQueuedValue === value) memoQueuedValue = null; // 失敗したので、もう一度、保存を依頼できるようにする
      if (!value && stillShown()) {              // 削除に失敗したときは、メモは残っている。表示を元に戻す
        memoValue = memoSaved;
        renderMemo();
        setMemoStatus('削除できませんでした。時間をおいて、もう一度お試しください', true);
        $('memo-retry-btn').hidden = true;
        return;
      }
      if (stillShown()) setMemoStatus('保存できませんでした(入力は、この画面に残っています)', true);
      return;
    }
    setThemeHasMemo(themeId, !!value.trim());
    if (stillShown()) {
      memoSaved = value;
      $('memo-badge').hidden = !value.trim();
      setMemoStatus(value ? '保存しました' : '削除しました');
      renderMemo();
    }
  }

  function setupMemo() {
    $('memo-toggle').addEventListener('click', () => {
      memoOpen = !memoOpen;
      renderMemo();
      // 書いたことがないメモは、開いたら、そのまま書き始められるようにする
      if (memoOpen && memoLoggedIn && !memoLoadFailed && !memoValue) startMemoEdit();
      if (!memoOpen) flushMemo();
    });
    $('memo-edit-btn').addEventListener('click', startMemoEdit);
    $('memo-delete-btn').addEventListener('click', () => { memoDeleting = true; renderMemo(); });
    $('memo-delete-cancel').addEventListener('click', () => { memoDeleting = false; renderMemo(); });
    $('memo-delete-yes').addEventListener('click', deleteMemo);
    $('memo-view').addEventListener('click', e => {
      if (!memoValue && !e.target.closest('a')) startMemoEdit(); // 空のメモは、欄そのものを押しても、書き始められる
    });
    $('memo-done-btn').addEventListener('click', finishMemoEdit);
    $('memo-retry-btn').addEventListener('click', () => { if (!memoLoadFailed) flushMemo(); });
    const ta = $('memo-textarea');
    ta.addEventListener('input', () => {
      memoValue = ta.value;
      updateMemoCount();
      setMemoStatus('');
      scheduleMemoSave();
    });
    ta.addEventListener('focus', () => { clearTimeout(memoBlurTimer); memoFocused = true; updateMemoEditingClass(); });
    // 「完了」などのボタンを押した瞬間にも、入力欄のカーソルは外れる。すぐに画面下のバーを出すと、バーが、押しているボタンに重なり、
    // ボタンを押したことにならない(指やマウスを離した場所が、ボタンではなくバーになる)。そのため、バーを出すのを、少しだけ遅らせる。
    ta.addEventListener('blur', () => {
      clearTimeout(memoBlurTimer);
      memoBlurTimer = setTimeout(() => { memoFocused = false; updateMemoEditingClass(); }, 400);
      flushMemo();
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(entries => {
        memoTextareaInView = entries[entries.length - 1].isIntersecting;
        updateMemoEditingClass();
      }).observe(ta);
    } else {
      memoTextareaInView = true;
    }
    // 画面を閉じる・アプリを切り替えるときに、まだ保存していない内容を、保存する(できる範囲で)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushMemo(); });
    window.addEventListener('pagehide', flushMemo);
  }

  // ── 6-2. 画面下の固定バー ──
  // カードが多く、下までスクロールすると、バケツの名前が画面から外れる。
  // 「バケツ名が、1つでも、画面内に完全に見えていない」間だけ、バケツ名のボタンを並べたバーを出す。
  // バーのボタンは、バケツ本体を押したときと、まったく同じ動き(activateBucket)になる。
  function bucketElById(bucketId) {
    return document.querySelector(`.bucket[data-bucket-id="${bucketId}"]`);
  }
  function getBucketBarChip(bucketId) {
    return document.querySelector(`#bucket-bar .bucket-bar-chip[data-bucket-id="${bucketId}"]`);
  }
  // 今、バーが画面に出ているなら、その高さ。出ていなければ0
  function bucketBarVisibleHeight() {
    const bar = $('bucket-bar');
    return (!bar.hidden && bar.classList.contains('show')) ? bar.offsetHeight : 0;
  }
  // 要素が、画面の中(バーに隠れない範囲)に、収まって見えているか
  function isVisibleAboveBar(el) {
    const margin = 8;
    const r = el.getBoundingClientRect();
    return r.top >= margin && r.bottom <= window.innerHeight - bucketBarVisibleHeight() - margin;
  }

  function hideBucketBar() {
    if (bucketBarObserver) { bucketBarObserver.disconnect(); bucketBarObserver = null; }
    bucketTitleVisible = {};
    const bar = $('bucket-bar');
    bar.classList.remove('show');
    bar.querySelectorAll('.explanation-bubble-wrap').forEach(el => el.remove());
    bar.hidden = true;
    document.body.classList.remove('has-bucket-bar');
  }

  function renderBucketBar(orderedBuckets) {
    // 閲覧モードでは、仕分けをしないので、バーは出さない。問題画面を閉じている間(読み込み中に一覧へ戻った場合など)も出さない
    if (isViewMode || !orderedBuckets.length || $('practice-view').hidden) { hideBucketBar(); return; }
    const inner = $('bucket-bar-inner');
    inner.innerHTML = '';
    inner.style.gridTemplateColumns = `repeat(${getBucketBarColumns(orderedBuckets.length)}, 1fr)`;
    orderedBuckets.forEach(bucket => {
      const btn = makeEl('button', 'bucket-bar-chip');
      btn.type = 'button';
      btn.dataset.bucketId = bucket.id;
      btn.dataset.title = bucket.title;
      btn.appendChild(makeEl('span', 'bucket-bar-chip-title', bucket.title));
      inner.appendChild(btn);
    });
    $('bucket-bar').hidden = false;
    document.body.classList.add('has-bucket-bar');
    syncBucketBarSelection();
    setupBucketBarObserver();
  }

  // 各バケツの名前(見出し)が、画面内に完全に見えているかを監視する。
  // バーが覆う、画面下の部分は、「画面の外」として数える(バーを出した結果、名前がバーの下に隠れても、
  // バーが消えて、またちらつく、ということが起きないようにするため)
  function setupBucketBarObserver() {
    if (bucketBarObserver) bucketBarObserver.disconnect();
    const bar = $('bucket-bar');
    if (bar.hidden) return;
    const barHeight = bar.offsetHeight;
    document.documentElement.style.setProperty('--bucket-bar-h', barHeight + 'px');
    bucketTitleVisible = {};
    document.querySelectorAll('#buckets .bucket').forEach(b => { bucketTitleVisible[b.dataset.bucketId] = false; });
    bucketBarObserver = new IntersectionObserver(entries => {
      entries.forEach(e => {
        const id = e.target.closest('.bucket').dataset.bucketId;
        bucketTitleVisible[id] = e.intersectionRatio >= 0.95;
      });
      updateBucketBar();
    }, { rootMargin: `0px 0px -${barHeight}px 0px`, threshold: [0, 0.95, 1] });
    document.querySelectorAll('#buckets .bucket .bucket-title').forEach(t => bucketBarObserver.observe(t));
  }

  function updateBucketBar() {
    const bar = $('bucket-bar');
    if (bar.hidden) return;
    const ids = Object.keys(bucketTitleVisible);
    const show = ids.length > 0 && ids.some(id => !bucketTitleVisible[id]);
    bar.classList.toggle('show', show);
    // バーが引っ込んだら、バーから出していた解説の吹き出しも、一緒に閉じる(出し元がなくなるため)
    if (!show && bar.querySelector('.explanation-bubble-wrap')) closeExplanationBubble();
  }

  function syncBucketBarSelection() {
    document.querySelectorAll('#bucket-bar .bucket-bar-chip').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.bucketId === selectedBucketId);
    });
  }

  // ── 6-3. バケツ ──
  // バケツを押したときの共通の動き(バケツ本体・バーのボタンの、どちらから押しても同じ)
  function activateBucket(bucketId) {
    // すでにカードを選択中なら、バケツを選んだ瞬間に判定する(カード→バケツの順)
    if (selectedQuestionId) {
      const questionId = selectedQuestionId;
      clearCardSelection();
      closeExplanationBubble();
      handleAnswer(questionId, bucketId);
      return;
    }

    // 同じバケツをもう一度タップしたら、選択をキャンセルする
    if (selectedBucketId === bucketId) {
      clearBucketSelection();
      return;
    }

    // バケツを先に選ぶ(バケツ→カードの順)
    closeExplanationBubble();
    if (selectedBucketEl) selectedBucketEl.classList.remove('selected');
    selectedBucketId = bucketId;
    selectedBucketEl = bucketElById(bucketId);
    if (selectedBucketEl) selectedBucketEl.classList.add('selected');
    syncBucketBarSelection();
  }

  function clearCardSelection() {
    if (selectedCardEl) selectedCardEl.classList.remove('selected');
    selectedQuestionId = null;
    selectedCardEl = null;
  }

  function clearBucketSelection() {
    if (selectedBucketEl) selectedBucketEl.classList.remove('selected');
    selectedBucketId = null;
    selectedBucketEl = null;
    syncBucketBarSelection();
  }

  // 仕分け済みのカード(バケツの中に並ぶカード)を作る。タップすれば、いつでも解説を見返せる
  function createSortedCard(question) {
    const chip = makeEl('div', 'card sorted', question.card_text);
    chip.addEventListener('click', e => {
      e.stopPropagation();
      showCardExplanation(chip, question.id, question.explanation);
    });
    return chip;
  }

  // currentBuckets を、今の設定(シャッフルの有無・閲覧モード)で描画する
  function renderBuckets() {
    const shuffle = isShuffleEnabled && currentThemeShuffleAllowed;
    const orderedBuckets = shuffle ? shuffleArray(currentBuckets.slice()) : currentBuckets;
    const el = $('buckets');
    el.innerHTML = '';

    orderedBuckets.forEach(bucket => {
      const div = makeEl('div', 'bucket');
      div.dataset.bucketId = bucket.id;

      // 閲覧モード: バケツの見出し(分類名)を隠し、タップで表示させる
      const title = makeEl('h3', 'bucket-title' + (isViewMode ? ' masked' : ''), isViewMode ? 'タップで表示' : bucket.title);
      if (isViewMode) title.dataset.title = bucket.title;
      div.append(title, makeEl('div', 'bucket-cards'));

      // タップで仕分け(カード選択済みの場合)、バケツを先に選ぶ操作、または閲覧モードでの見出し表示切り替え
      div.addEventListener('click', e => {
        if (isViewMode) {
          if (title.classList.contains('masked') && e.target === title) {
            title.classList.remove('masked');
            title.textContent = title.dataset.title;
          }
          return;
        }
        activateBucket(bucket.id);
      });

      // ドラッグ&ドロップで仕分け(PC向け)
      div.addEventListener('dragover', e => { e.preventDefault(); div.classList.add('drag-over'); });
      div.addEventListener('dragleave', () => div.classList.remove('drag-over'));
      div.addEventListener('drop', e => {
        e.preventDefault();
        div.classList.remove('drag-over');
        handleAnswer(e.dataTransfer.getData('text/plain'), bucket.id);
      });

      el.appendChild(div);
    });

    // 仕分け済みのカードを差し込む。閲覧モードでは全カード、仕分けモードでは、
    // バケツの位置をシャッフルし直した際などに、すでに正解済みのカードが消えないよう、あらためて差し込み直す
    currentQuestions.filter(q => sortedIds.has(q.id)).forEach(q => {
      const bucketCardsEl = bucketCardsElById(q.answer_bucket_id);
      if (bucketCardsEl) bucketCardsEl.appendChild(createSortedCard(q));
    });

    // 画面下の固定バーも、同じ並びで作り直す(シャッフル後の並びも反映される)
    renderBucketBar(orderedBuckets);
  }

  function bucketCardsElById(bucketId) {
    return document.querySelector(`.bucket[data-bucket-id="${bucketId}"] .bucket-cards`);
  }

  // ── 6-4. カード ──
  function renderDeck() {
    const el = $('deck');
    el.innerHTML = '';
    currentQuestions
      .filter(q => !sortedIds.has(q.id))
      .forEach(q => {
        const card = makeEl('div', 'card', q.card_text);
        card.draggable = true;
        card.dataset.questionId = q.id;

        card.addEventListener('click', () => selectCard(q.id, card));
        card.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', q.id));

        el.appendChild(card);
      });
  }

  function selectCard(questionId, cardEl) {
    if (cardEl.classList.contains('sorted')) return;

    // すでにバケツを選択中なら、カードを選んだ瞬間に判定する(バケツ→カードの順)
    // バケツの選択は解除せず、続けて他のカードもそのバケツに入れられるようにする
    if (selectedBucketId) {
      closeExplanationBubble();
      handleAnswer(questionId, selectedBucketId);
      return;
    }

    // 同じカードをもう一度タップしたら、選択をキャンセルする
    if (selectedQuestionId === questionId) {
      clearCardSelection();
      return;
    }

    closeExplanationBubble();
    if (selectedCardEl) selectedCardEl.classList.remove('selected');
    selectedQuestionId = questionId;
    selectedCardEl = cardEl;
    cardEl.classList.add('selected');
  }

  // ── 6-5. 解説の吹き出し ──
  function buildBubble(text, isIncorrect) {
    const wrap = makeEl('div', 'explanation-bubble-wrap' + (isIncorrect ? ' incorrect' : ''));
    const bubble = makeEl('div', 'explanation-bubble' + (isIncorrect ? ' incorrect' : ''), text);
    wrap.appendChild(bubble);
    return { wrap, bubble };
  }

  // 仕分け済みチップをタップしたときの共通処理。
  // 「今、どのquestion_idの吹き出しが開いているか」は、openBubbleQuestionIdという、
  // 1つの変数だけで一元管理する。
  // keepBucketSelected: trueの場合、バケツの選択(連続投入のための状態)は解除しない。
  // 「②バケツ→カード」の流れで、正解した、まさにその瞬間に使う。
  // barAnchorEl: 指定すると、吹き出しを、そのバーのボタンから上向きに出す
  // (入ったカードが、画面の外にあって、そのカードからの吹き出しが見えないとき用)
  function showCardExplanation(chipEl, questionId, explanation, keepBucketSelected, barAnchorEl) {
    clearCardSelection();
    if (!keepBucketSelected) clearBucketSelection();

    const wasOpen = openBubbleQuestionId === questionId;

    // 既存の吹き出し・強調表示は、いったんすべて消す
    document.querySelectorAll('.explanation-bubble-wrap').forEach(el => el.remove());
    document.querySelectorAll('.card.sorted.highlighted').forEach(el => el.classList.remove('highlighted'));

    openBubbleQuestionId = wasOpen ? null : questionId;

    // 直前まで、このカード自身が開いていた場合は、そのまま閉じて終わる(トグル)
    if (wasOpen) return;

    chipEl.classList.add('highlighted');

    const { wrap, bubble } = buildBubble(explanation, false);
    if (barAnchorEl) {
      // バーの中に置く。横位置は、そのボタンの真上、縦位置は「バー全体の上端」に合わせる。
      // (下の段のボタンの真上に置くと、上の段のボタンを覆って押せなくなるため)
      const bar = $('bucket-bar');
      const barRect = bar.getBoundingClientRect();
      const btnRect = barAnchorEl.getBoundingClientRect();
      wrap.style.left = (btnRect.left + btnRect.width / 2 - barRect.left) + 'px';
      wrap.style.bottom = (barRect.height + 12) + 'px';
      bar.appendChild(wrap);
    } else {
      chipEl.appendChild(wrap);
    }

    requestAnimationFrame(() => {
      wrap.classList.add('show');
      adjustBubblePosition(wrap, bubble, !!barAnchorEl);
    });
  }

  // 不正解のとき、選んだ、そのカード自身の近くに、吹き出しで解説を表示する(赤系の配色)
  function showIncorrectExplanation(targetEl, explanation) {
    closeExplanationBubble();
    const { wrap, bubble } = buildBubble(explanation, true);
    targetEl.appendChild(wrap);

    requestAnimationFrame(() => {
      wrap.classList.add('show');
      adjustBubblePosition(wrap, bubble);
    });
  }

  // 吹き出し・強調表示を、DOM要素ごと、確実に消す
  function closeExplanationBubble() {
    document.querySelectorAll('.explanation-bubble-wrap').forEach(el => el.remove());
    document.querySelectorAll('.card.sorted.highlighted').forEach(el => el.classList.remove('highlighted'));
    openBubbleQuestionId = null;
  }

  // 吹き出しが、画面の左右・上端からはみ出さないよう、表示後に位置・高さを調整する
  // 画面の下端は、バーが出ているときは、バーの上端とする。fromBar: バーのボタンから出す吹き出し(下向きには切り替えない)
  function adjustBubblePosition(wrap, bubble, fromBar) {
    const margin = 8;
    const bottomLimit = window.innerHeight - bucketBarVisibleHeight();
    const minHeightNeeded = 80; // 最低限、これだけの高さが確保できないなら、下向きに切り替える

    // 上に表示した場合の、実際に確保できる高さを、先に見積もる
    const rectAbove = wrap.getBoundingClientRect();
    const availableAbove = rectAbove.bottom - margin;

    if (!fromBar && rectAbove.top < margin && availableAbove < minHeightNeeded) {
      // 上のスペースが、足りないので、下向きに切り替える
      wrap.classList.add('below');
    }

    const rect = wrap.getBoundingClientRect();
    let shift = 0;
    if (rect.left < margin) {
      shift = margin - rect.left;
    } else if (rect.right > window.innerWidth - margin) {
      shift = (window.innerWidth - margin) - rect.right;
    }
    if (shift !== 0) {
      wrap.style.setProperty('--shift', shift + 'px');
      wrap.style.setProperty('--arrow-offset', (-shift) + 'px');
    }

    const updatedRect = wrap.getBoundingClientRect();
    if (wrap.classList.contains('below')) {
      // 下向きのときは、画面の下端から、はみ出していないかを確認する
      if (updatedRect.bottom > bottomLimit - margin) {
        const available = (bottomLimit - margin) - updatedRect.top;
        bubble.style.maxHeight = Math.max(60, available) + 'px';
      }
    } else if (updatedRect.top < margin) {
      // 上向きのままの場合、それでも上端からはみ出すなら、高さを縮める
      const available = updatedRect.bottom - margin;
      bubble.style.maxHeight = available + 'px';
    }
  }

  // ── 6-6. 正誤判定・フィードバック・ログ保存 ──
  // 不正解のとき、選んだバケツを赤く光らせて揺らし、「✕ 違います」を短く表示する。
  // カードが画面の下にあって、バケツ側からは何も見えない場合でも、間違えたことに気づけるようにするため
  function flashWrongBucket(bucketId) {
    // 固定バーが出ているときは、バーのボタンも、同じように揺らす(こちらは、必ず画面内にある)
    const barBtn = getBucketBarChip(bucketId);
    if (barBtn) {
      const titleEl = barBtn.querySelector('.bucket-bar-chip-title');
      clearTimeout(barBtn._wrongTimer);
      barBtn.classList.remove('wrong-flash');
      void barBtn.offsetWidth;
      barBtn.classList.add('wrong-flash');
      titleEl.textContent = '✕ 違います';
      barBtn._wrongTimer = setTimeout(() => {
        barBtn.classList.remove('wrong-flash');
        titleEl.textContent = barBtn.dataset.title;
      }, 1200);
    }

    const bucketEl = bucketElById(bucketId);
    if (!bucketEl) return;
    clearTimeout(bucketEl._wrongTimer);
    bucketEl.classList.remove('wrong-flash');
    bucketEl.querySelectorAll('.bucket-wrong-label').forEach(el => el.remove());
    void bucketEl.offsetWidth; // 連続で間違えたときも、アニメーションを最初から再生するため
    bucketEl.classList.add('wrong-flash');
    const label = makeEl('div', 'bucket-wrong-label', '✕ 違います');
    bucketEl.appendChild(label);
    bucketEl._wrongTimer = setTimeout(() => {
      bucketEl.classList.remove('wrong-flash');
      label.remove();
    }, 1200);
  }

  async function handleAnswer(selectedId, bucketId) {
    const result = judgeAnswer(currentQuestions, sortedIds, selectedId, bucketId);
    if (!result) return;
    const { question, isCorrect, incorrectMessage } = result;
    const questionId = question.id; // 同じ文言のカードの入れ替えがあると、選んだカードとは別のID
    const themeId = currentThemeId; // ログ保存を待つ間に、別のテーマへ移っても、解答したテーマで記録する

    if (isCorrect) {
      sortedIds.add(questionId);
      const bucketCardsEl = bucketCardsElById(bucketId);
      if (bucketCardsEl) {
        const chip = createSortedCard(question);
        bucketCardsEl.appendChild(chip);
        // 正解した、まさにその瞬間も、吹き出しで解説を表示する。
        // 「②バケツ→カード」で、連続してカードを入れている最中は、バケツの選択を維持したままにする。
        // ただし、入ったカードが画面の外にあり、固定バーが出ているときは、バーのそのバケツのボタンから出す
        // (そうしないと、解説が、画面の外に出て、読めない)
        const barBtn = getBucketBarChip(bucketId);
        const useBar = !!barBtn && bucketBarVisibleHeight() > 0 && !isVisibleAboveBar(chip);
        showCardExplanation(chip, questionId, question.explanation, selectedBucketId === bucketId, useBar ? barBtn : null);
      }
      // (バケツの選択は解除しない。続けて同じバケツに他のカードを入れられるようにするため)
      clearCardSelection();
    }

    // 通信を待たず、画面の更新はここで即座に行う
    renderDeck();

    if (!isCorrect) {
      flashWrongBucket(bucketId);
      // 不正解の場合、カードはデッキに残るが、renderDeck()で作り直されるため、
      // 吹き出しの表示は、renderDeck()の後に、あらためて行う
      const cardEl = document.querySelector(`.card[data-question-id="${questionId}"]`);
      if (cardEl) {
        // まだ正しい判断ができていないため、カードの選択(青い枠)を、そのまま維持する
        selectedQuestionId = questionId;
        selectedCardEl = cardEl;
        cardEl.classList.add('selected');
        showIncorrectExplanation(cardEl, incorrectMessage);
      }
    }

    // ログイン済みユーザーのみ解答ログを保存(画面表示とは切り離し、裏側で行う)
    const user = await getCurrentUser();
    if (user) {
      const { error: logError } = await supabaseClient.from('user_answer_logs').insert({
        user_id: user.id,
        theme_id: themeId,
        question_id: questionId,
        selected_bucket_id: bucketId,
        is_correct: isCorrect
      });
      if (logError) console.error('解答ログの保存に失敗しました:', logError);
    } else {
      console.warn('未ログインのため、解答ログは保存されません。');
    }
  }

  // ── 7. 起動 ─────────────────────────────────────
  function setupEventListeners() {
    $('back-to-list-btn').addEventListener('click', showListView);
    $('filter-category-select').addEventListener('change', applyListFilter);
    $('theme-bookmark-btn').addEventListener('click', toggleCurrentThemeBookmark);
    $('reset-progress-btn').addEventListener('click', resetThemeProgress);
    $('next-theme-btn').addEventListener('click', goToNextTheme);
    $('random-theme-btn').addEventListener('click', goToRandomTheme);
    $('redeem-code-btn').addEventListener('click', redeemCode);

    // モード切替(問題画面では、そのテーマを読み込み直す。一覧画面では、次に開くときの初期モードを切り替えるだけ)
    $('mode-toggle-btn').addEventListener('click', () => {
      isViewMode = !isViewMode;
      updateModeBadges();
      if (currentThemeId) loadTheme(currentThemeId);
    });
    $('list-mode-toggle-btn').addEventListener('click', () => {
      isViewMode = !isViewMode;
      updateModeBadges();
    });

    // シャッフル(問題画面では、通信せずに、メモリ上のバケツを並べ直す)
    $('shuffle-toggle-btn').addEventListener('click', () => {
      toggleShuffleSetting();
      clearBucketSelection(); // バケツを作り直すため、古い選択状態(DOM参照)は、念のためクリアする
      closeExplanationBubble(); // バケツの位置が変わるため、吹き出しも一緒に閉じる
      if (currentBuckets.length) renderBuckets();
    });
    $('list-shuffle-toggle-btn').addEventListener('click', toggleShuffleSetting);

    // 固定バーのボタンを押したときは、バケツ本体を押したときと同じ動きにする
    $('bucket-bar').addEventListener('click', e => {
      const btn = e.target.closest('.bucket-bar-chip');
      if (btn && !isViewMode) activateBucket(btn.dataset.bucketId);
    });
    // 固定バーのボタンにも、ドラッグ&ドロップで仕分けできるようにする(PC向け。バケツ本体と同じ動き)
    const bar = $('bucket-bar');
    const clearBarDragOver = () => bar.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    bar.addEventListener('dragover', e => {
      const btn = e.target.closest('.bucket-bar-chip');
      if (!btn) return;
      e.preventDefault();
      clearBarDragOver();
      btn.classList.add('drag-over');
    });
    bar.addEventListener('dragleave', e => {
      const btn = e.target.closest('.bucket-bar-chip');
      if (btn && !btn.contains(e.relatedTarget)) btn.classList.remove('drag-over');
    });
    bar.addEventListener('drop', e => {
      const btn = e.target.closest('.bucket-bar-chip');
      if (!btn) return;
      e.preventDefault();
      clearBarDragOver();
      handleAnswer(e.dataTransfer.getData('text/plain'), btn.dataset.bucketId);
    });

    // 画面の向きや幅が変わると、バーの高さも変わるので、判定の基準を取り直す
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!$('bucket-bar').hidden) setupBucketBarObserver();
      }, 150);
    });

    // カード・バケツ以外の何もない場所をタップしたら、選択中の状態をまとめて解除する
    document.addEventListener('click', e => {
      if (e.target.closest('.card') || e.target.closest('.bucket')) return;
      // 固定バー(ボタンと、そこから出た吹き出し)は、バケツと同じ扱い。ここで選択を解除してはいけない
      if (e.target.closest('.bucket-bar') || e.target.closest('.explanation-bubble-wrap')) return;
      clearCardSelection();
      clearBucketSelection();
      closeExplanationBubble();
    });
  }

  $('lock-note-link').href = NOTE_ARTICLE_URL;
  setupEventListeners();
  setupListFilters();
  setupSearch();
  setupMemo();
  updateSortButtons();
  updateModeBadges();
  updateShuffleToggleButton();
  loadAnnouncement();
  startAuthTokenCleanup();
  initListView();
