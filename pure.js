// ヨコトキ  純粋なロジック
// 画面(document)にも通信(supabase)にも触れない関数だけを置く。app.js より先に読み込む。
// tests/unit.test.js が、このファイルをそのまま読み込んで検査する。

  // Fisher-Yatesアルゴリズムで配列をシャッフルする(この配列自体を並べ替える)
  function shuffleArray(array, random = Math.random) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  // 周回数 = 回答回数 ÷ カード枚数。カード枚数が不明(0)のときは、回答回数そのものを使う
  function getRounds(t) {
    const attempts = t.attemptCount || 0;
    return t.questionCount > 0 ? attempts / t.questionCount : attempts;
  }

  // 並べ替えモードごとの比較関数。一覧画面と「次へ」で同じ基準を使うため、1か所にまとめている。
  // 未挑戦のテーマは常に先頭。同順位のときは元のテーマ順を保つ(sortは安定ソート)
  function getThemeComparator(mode) {
    if (mode === 'accuracy') {
      return (a, b) => {
        if (a.accuracy === null && b.accuracy === null) return 0;
        if (a.accuracy === null) return -1;
        if (b.accuracy === null) return 1;
        return a.accuracy - b.accuracy;
      };
    }
    if (mode === 'lastAnswered') {
      return (a, b) => {
        if (!a.lastAnsweredAt && !b.lastAnsweredAt) return 0;
        if (!a.lastAnsweredAt) return -1;
        if (!b.lastAnsweredAt) return 1;
        return new Date(a.lastAnsweredAt) - new Date(b.lastAnsweredAt);
      };
    }
    if (mode === 'attempts') {
      // 周回数(回答回数 ÷ カード枚数)が少ない順。未挑戦=0が先頭になる
      return (a, b) => getRounds(a) - getRounds(b);
    }
    return () => 0;
  }

  // 「7/1に回答」のような、短い表示形式に整形する(未挑戦はnull)
  function formatLastAnsweredAt(isoString) {
    if (!isoString) return '未挑戦';
    const d = new Date(isoString);
    const yy = String(d.getFullYear()).slice(-2);
    return `${yy}/${d.getMonth() + 1}/${d.getDate()}に回答`;
  }

  // 固定バーのボタンの列数(バケツ3つ以下はその数、6つまでは3列、7つ以上は4列)
  function getBucketBarColumns(bucketCount) {
    return bucketCount <= 3 ? bucketCount : bucketCount <= 6 ? 3 : 4;
  }

  // カードの文言の比較用(前後の空白は無視する)
  function sameCardText(a, b) {
    return a.card_text.trim() === b.card_text.trim();
  }

  // 「このカードを、このバケツに入れた」ときの正誤を判定する。
  //   questions: そのテーマの全カード / sortedIds: 仕分け済みのカードIDのSet
  // 戻り値: { question, isCorrect, incorrectMessage }。カードが見つからなければnull。
  //   question: 実際に判定の対象になったカード(下記の入れ替えがあると、選んだカードとは別のカードになる)
  //   incorrectMessage: 不正解のときに見せる文(正解のときはnull)
  function judgeAnswer(questions, sortedIds, questionId, bucketId) {
    let question = questions.find(q => q.id === questionId);
    if (!question) return null;

    // 同じ文言のカードが複数ある場合(例: 「有権者の50分の1」が議員の解職請求用と長の解職請求用で
    // 2枚ある)、画面上は見分けがつかない。選んだカード自身が不正解でも、同じ文言で
    // 「このバケツが正解」の未仕分けカードが残っていれば、そちらを使って判定する。
    // (解説・解答ログも、実際に正解扱いにしたカードのものになる)
    if (question.answer_bucket_id !== bucketId) {
      const target = question;
      const sameTextCard = questions.find(q =>
        q.id !== target.id &&
        !sortedIds.has(q.id) &&
        sameCardText(q, target) &&
        q.answer_bucket_id === bucketId
      );
      if (sameTextCard) question = sameTextCard;
    }

    if (question.answer_bucket_id === bucketId) {
      return { question, isCorrect: true, incorrectMessage: null };
    }

    // 同じ文言のカードがこのテーマに2枚以上あるときは、どのカードをタップしたかで解説が
    // 変わってしまうため、カード固有の解説ではなく、共通の文を表示する
    const sameTextCards = questions.filter(q => q.id !== question.id && sameCardText(q, question));
    // 同じ文言のカードが、すでにこのバケツに仕分け済みの場合(例: 2枚目を同じバケツに入れようとした)は、
    // 「入りません」ではなく「すでに入っています」と伝える
    const alreadyInBucket = sameTextCards.some(q => sortedIds.has(q.id) && q.answer_bucket_id === bucketId);

    let incorrectMessage = question.explanation;
    if (alreadyInBucket) {
      incorrectMessage = `「${question.card_text.trim()}」は、すでにこのバケツに入っています。このカードは、別のバケツに入ります。`;
    } else if (sameTextCards.length > 0) {
      incorrectMessage = `「${question.card_text.trim()}」は、このバケツには入りません。`;
    }
    return { question, isCorrect: false, incorrectMessage };
  }
  // 検索欄の文字を、キーワードの配列にする。半角・全角のスペースで区切り、1文字の語は捨て、重複を除く。
  // 1語あたり50文字まで、最大5語(DB側の search_themes と同じ上限)。
  function parseSearchKeywords(text) {
    const words = String(text || '').split(/[\s\u3000]+/)
      .filter(w => [...w].length >= 2 && [...w].length <= 50);
    return [...new Set(words)].slice(0, 5);
  }

  // ヒットの内訳を、一覧に出す1行の文にする(カードの答えとなるバケツ名は、出さない)
  function formatSearchHit(hit) {
    const parts = [];
    if (hit.title_hit) parts.push('テーマ名');
    if (hit.bucket_hits) parts.push(`バケツ${hit.bucket_hits}`);
    if (hit.card_hits) parts.push(`カード${hit.card_hits}`);
    if (hit.explanation_hits) parts.push(`解説${hit.explanation_hits}`);
    if (hit.memo_hit) parts.push('メモ');
    return parts.length ? 'ヒット: ' + parts.join('・') : '';
  }
  // 「間違いの報告」のGoogleフォームを開くリンクを作る。テーマ名とテーマIDが、フォームに入力済みの状態で開く。
  //   formUrl: フォームのURL(.../viewform)。Googleフォーム以外のURLや、空のときは、'' を返す(=リンクを出さない)
  //   nameEntry / idEntry: フォームの「事前入力したURL」にある、質問ごとの番号(entry.数字)
  function buildReportUrl(formUrl, nameEntry, idEntry, themeName, themeId) {
    if (typeof formUrl !== 'string' || !/^https:\/\/docs\.google\.com\/forms\/d\/e\/[A-Za-z0-9_-]+\/viewform$/.test(formUrl)) return '';
    if (!/^entry\.\d+$/.test(nameEntry || '') || !/^entry\.\d+$/.test(idEntry || '')) return '';
    const enc = v => encodeURIComponent(String(v == null ? '' : v));
    return `${formUrl}?usp=pp_url&${nameEntry}=${enc(themeName)}&${idEntry}=${enc(themeId)}`;
  }
  // メモの文章を、「ふつうの文字」と「リンク」の並びに分ける。
  // リンクにするのは、http:// か https:// で始まるURLだけ(javascript: などは、リンクにしない)。
  // URLに使える文字は、半角の英数字と記号だけ。日本語の文章がURLのすぐ後ろに続いても、そこでURLは終わる
  // (URLに日本語を含めたいときは、ブラウザからコピーした、%で書かれた形で貼る)。
  // 文末の「.」「,」「)」などは、URLに含めない(ただし、(  )が対になっているURLは、そのまま)。
  function splitMemoLinks(text) {
    const source = String(text || '');
    const parts = [];
    const re = /https?:\/\/[A-Za-z0-9\-._~:\/?#\[\]@!$&'()*+,;=%]+/gi;
    const count = (str, ch) => str.split(ch).length - 1;
    let last = 0;
    let m;
    while ((m = re.exec(source)) !== null) {
      let url = m[0];
      for (;;) {
        const c = url[url.length - 1];
        if (/[.,;:!?'*]/.test(c)) url = url.slice(0, -1);
        else if (c === ')' && count(url, '(') < count(url, ')')) url = url.slice(0, -1);
        else if (c === ']' && count(url, '[') < count(url, ']')) url = url.slice(0, -1);
        else break;
      }
      if (url.replace(/^https?:\/\//i, '') === '') { re.lastIndex = m.index + 1; continue; } // 「https://」だけは、リンクにしない
      if (m.index > last) parts.push({ type: 'text', value: source.slice(last, m.index) });
      parts.push({ type: 'link', value: url, href: url });
      last = m.index + url.length;
      re.lastIndex = last; // 削った末尾の文字は、ふつうの文字として、続きを探す
    }
    if (last < source.length) parts.push({ type: 'text', value: source.slice(last) });
    return parts;
  }
