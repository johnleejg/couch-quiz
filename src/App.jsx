import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";

const answerColors = ["coral", "gold", "teal", "blue", "purple", "pink"];
const timePresets = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
const pointValues = [0, 1000, 2000];

const createQuestion = (type = "quiz") => ({
  type,
  prompt: type === "true-false" ? "New true or false question" : "New quiz question",
  seconds: 20,
  points: 1000,
  multiSelect: false,
  media: null,
  options:
    type === "true-false"
      ? [
          { text: "True", imageUrl: "" },
          { text: "False", imageUrl: "" },
        ]
      : [
          { text: "Answer one", imageUrl: "" },
          { text: "Answer two", imageUrl: "" },
          { text: "Answer three", imageUrl: "" },
          { text: "Answer four", imageUrl: "" },
        ],
  correctIndexes: [0],
});

const starterQuiz = {
  title: "Couch Classics",
  questions: [
    {
      ...createQuestion(),
      prompt: "Which planet has the shortest day?",
      options: ["Earth", "Jupiter", "Mars", "Venus"].map((text) => ({ text, imageUrl: "" })),
      correctIndexes: [1],
    },
    {
      ...createQuestion("true-false"),
      prompt: "A group of flamingos is called a flamboyance.",
      correctIndexes: [0],
    },
    {
      ...createQuestion(),
      prompt: "How many hearts does an octopus have?",
      options: ["One", "Two", "Three", "Eight"].map((text) => ({ text, imageUrl: "" })),
      correctIndexes: [2],
    },
  ],
};

const migrateQuiz = (rawQuiz) => ({
  title: String(rawQuiz?.title || starterQuiz.title),
  questions: (Array.isArray(rawQuiz?.questions) ? rawQuiz.questions : starterQuiz.questions).map(
    (rawQuestion) => {
      const type = rawQuestion?.type === "true-false" ? "true-false" : "quiz";
      const base = createQuestion(type);
      const options =
        type === "true-false"
          ? base.options
          : (Array.isArray(rawQuestion?.options) ? rawQuestion.options : base.options)
              .slice(0, 6)
              .map((option) => ({
                text: typeof option === "string" ? option : String(option?.text || ""),
                imageUrl: typeof option === "object" ? String(option?.imageUrl || "") : "",
              }));
      return {
        ...base,
        ...rawQuestion,
        type,
        prompt: String(rawQuestion?.prompt || base.prompt).slice(0, 120),
        seconds: Math.max(5, Math.min(240, Number(rawQuestion?.seconds) || 20)),
        points: pointValues.includes(Number(rawQuestion?.points)) ? Number(rawQuestion.points) : 1000,
        multiSelect: type === "quiz" && Boolean(rawQuestion?.multiSelect),
        media: rawQuestion?.media?.url ? rawQuestion.media : null,
        options,
        correctIndexes: Array.isArray(rawQuestion?.correctIndexes)
          ? rawQuestion.correctIndexes.map(Number)
          : [Number(rawQuestion?.correctIndex) || 0],
      };
    },
  ),
});

const formatCode = (code = "") =>
  String(code)
    .replace(/\D/g, "")
    .slice(0, 6)
    .replace(/(\d{3})(?=\d)/, "$1 ");

function Brand({ compact = false }) {
  return (
    <div className={`brand ${compact ? "brand--compact" : ""}`} aria-label="Couch Quiz">
      <span>COUCH</span>
      <span>QUIZ</span>
    </div>
  );
}

function Decorations() {
  return (
    <div className="decorations" aria-hidden="true">
      <i className="shape shape--triangle" />
      <i className="shape shape--bolt" />
      <i className="shape shape--star">✦</i>
      <i className="shape shape--zig">M</i>
    </div>
  );
}

function Timer({ value, total = 20, compact = false }) {
  const radius = compact ? 27 : 43;
  const size = compact ? 70 : 108;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(1, value / total));
  return (
    <div className={`timer ${compact ? "timer--compact" : ""}`} aria-label={`${value} seconds left`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="timer__track" cx={size / 2} cy={size / 2} r={radius} />
        <circle
          className="timer__progress"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
        />
      </svg>
      <strong>{value}</strong>
    </div>
  );
}

function embedUrl(media) {
  if (!media?.url) return "";
  try {
    const parsed = new URL(media.url, window.location.origin);
    if (media.kind === "youtube") {
      const id = parsed.hostname.includes("youtu.be")
        ? parsed.pathname.slice(1)
        : parsed.searchParams.get("v") || parsed.pathname.split("/").filter(Boolean).pop();
      return id ? `https://www.youtube.com/embed/${id}` : "";
    }
    if (media.kind === "vimeo") {
      const id = parsed.pathname.split("/").filter(Boolean).pop();
      return id ? `https://player.vimeo.com/video/${id}` : "";
    }
  } catch {
    return "";
  }
  return "";
}

function QuestionMedia({ media }) {
  if (!media?.url) return null;
  if (media.kind === "image") {
    return <img className="question-media" src={media.url} alt="" />;
  }
  const src = embedUrl(media);
  return src ? (
    <iframe
      className="question-media question-media--video"
      src={src}
      title="Question video"
      allow="autoplay; encrypted-media; picture-in-picture"
      allowFullScreen
    />
  ) : null;
}

function AnswerGrid({
  options,
  onSelect,
  selectedIndexes = [],
  disabled,
  correctIndexes,
  player = false,
}) {
  const hasCorrectAnswers = Array.isArray(correctIndexes);
  return (
    <div
      className={[
        "answer-grid",
        player ? "answer-grid--player" : "",
        options.length > 4 ? "answer-grid--dense" : "",
      ].join(" ")}
    >
      {options.map((option, index) => {
        const selected = selectedIndexes.includes(index);
        const correct = hasCorrectAnswers && correctIndexes.includes(index);
        const wrongSelection = hasCorrectAnswers && selected && !correct;
        return (
          <button
            className={[
              "answer",
              `answer--${answerColors[index % answerColors.length]}`,
              option.imageUrl ? "answer--with-image" : "",
              selected ? "is-selected" : "",
              correct ? "is-correct" : "",
              wrongSelection ? "is-wrong" : "",
            ].join(" ")}
            disabled={disabled}
            key={`${option.text}-${option.imageUrl}-${index}`}
            onClick={() => onSelect?.(index)}
          >
            <span className="answer__marker">{String.fromCharCode(65 + index)}</span>
            {option.imageUrl ? <img src={option.imageUrl} alt="" /> : null}
            {option.text ? <span>{option.text}</span> : <span className="answer__image-label">Image answer</span>}
          </button>
        );
      })}
    </div>
  );
}

function Leaderboard({ players, podium = false }) {
  const sorted = players.slice(0, podium ? 3 : 5);
  return (
    <div className={`leaderboard ${podium ? "leaderboard--podium" : ""}`}>
      {sorted.map((player, index) => (
        <div className="leaderboard__row" key={player.id}>
          <span className="leaderboard__rank">{index + 1}</span>
          <span className="leaderboard__name">
            {player.name}
            {!player.online && !podium ? <em>offline</em> : null}
          </span>
          <strong>{player.score.toLocaleString()}</strong>
        </div>
      ))}
      {!sorted.length ? <p className="empty-copy">Waiting for the first player...</p> : null}
    </div>
  );
}

function Home() {
  return (
    <main className="home">
      <Decorations />
      <div className="home__panel">
        <Brand />
        <h1>Turn the couch into a game show.</h1>
        <p>Host on the big screen. Everyone else joins from a phone on the same Wi-Fi.</p>
        <div className="home__actions">
          <a className="button button--primary" href="/host">
            Host a game
          </a>
          <a className="button button--light" href="/play">
            Join a game
          </a>
        </div>
      </div>
    </main>
  );
}

function ImageUploadButton({ onUploaded, compact = false }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const uploadFile = async (file) => {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("image", file);
      const response = await fetch("/api/uploads", { method: "POST", body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Upload failed.");
      onUploaded(result.url);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <span className={`image-upload ${compact ? "image-upload--compact" : ""}`}>
      <label className="upload-button">
        {uploading ? "Uploading..." : "Upload image"}
        <input
          type="file"
          accept="image/*"
          disabled={uploading}
          onChange={(event) => uploadFile(event.target.files?.[0])}
        />
      </label>
      {error ? <small>{error}</small> : null}
    </span>
  );
}

function QuestionEditor({ quiz, setQuiz }) {
  const [allSeconds, setAllSeconds] = useState(20);
  const [allPoints, setAllPoints] = useState(1000);

  const updateQuestion = (questionIndex, key, value) => {
    setQuiz((current) => ({
      ...current,
      questions: current.questions.map((question, index) =>
        index === questionIndex ? { ...question, [key]: value } : question,
      ),
    }));
  };

  const changeType = (questionIndex, type) => {
    const current = quiz.questions[questionIndex];
    updateQuestion(questionIndex, "type", type);
    setQuiz((state) => ({
      ...state,
      questions: state.questions.map((question, index) =>
        index === questionIndex
          ? {
              ...question,
              type,
              options: createQuestion(type).options,
              correctIndexes: [0],
              multiSelect: false,
            }
          : question,
      ),
    }));
    if (!current) return;
  };

  const updateOption = (questionIndex, optionIndex, key, value) => {
    const nextOptions = quiz.questions[questionIndex].options.map((option, index) =>
      index === optionIndex ? { ...option, [key]: value } : option,
    );
    updateQuestion(questionIndex, "options", nextOptions);
  };

  const toggleCorrect = (questionIndex, optionIndex) => {
    const question = quiz.questions[questionIndex];
    if (!question.multiSelect || question.type === "true-false") {
      updateQuestion(questionIndex, "correctIndexes", [optionIndex]);
      return;
    }
    const next = question.correctIndexes.includes(optionIndex)
      ? question.correctIndexes.filter((index) => index !== optionIndex)
      : [...question.correctIndexes, optionIndex];
    updateQuestion(questionIndex, "correctIndexes", next);
  };

  const addOption = (questionIndex) => {
    const question = quiz.questions[questionIndex];
    if (question.options.length >= 6) return;
    updateQuestion(questionIndex, "options", [...question.options, { text: "", imageUrl: "" }]);
  };

  const removeOption = (questionIndex, optionIndex) => {
    const question = quiz.questions[questionIndex];
    if (question.options.length <= 2) return;
    updateQuestion(
      questionIndex,
      "options",
      question.options.filter((_, index) => index !== optionIndex),
    );
    const nextCorrect = question.correctIndexes
      .filter((index) => index !== optionIndex)
      .map((index) => (index > optionIndex ? index - 1 : index));
    updateQuestion(questionIndex, "correctIndexes", nextCorrect);
  };

  const addQuestion = (type) => {
    setQuiz((current) => ({
      ...current,
      questions: [...current.questions, createQuestion(type)],
    }));
  };

  const removeQuestion = (questionIndex) => {
    setQuiz((current) => ({
      ...current,
      questions: current.questions.filter((_, index) => index !== questionIndex),
    }));
  };

  const setAll = (key, value) => {
    setQuiz((current) => ({
      ...current,
      questions: current.questions.map((question) => ({ ...question, [key]: value })),
    }));
  };

  return (
    <div className="editor">
      <label className="field field--title">
        <span>Quiz title</span>
        <input
          value={quiz.title}
          maxLength={60}
          onChange={(event) => setQuiz({ ...quiz, title: event.target.value })}
        />
      </label>
      <section className="bulk-controls">
        <strong>Apply to every question</strong>
        <label>
          <span>Time</span>
          <select value={allSeconds} onChange={(event) => setAllSeconds(Number(event.target.value))}>
            {timePresets.map((seconds) => (
              <option key={seconds} value={seconds}>
                {seconds < 60 ? `${seconds} sec` : `${seconds / 60} min`}
              </option>
            ))}
          </select>
          <button onClick={() => setAll("seconds", allSeconds)}>Set all</button>
        </label>
        <label>
          <span>Points</span>
          <select value={allPoints} onChange={(event) => setAllPoints(Number(event.target.value))}>
            {pointValues.map((points) => (
              <option key={points} value={points}>
                {points.toLocaleString()}
              </option>
            ))}
          </select>
          <button onClick={() => setAll("points", allPoints)}>Set all</button>
        </label>
      </section>
      <div className="editor__questions">
        {quiz.questions.map((question, questionIndex) => (
          <section className="question-editor" key={questionIndex}>
            <header>
              <div>
                <strong>Question {questionIndex + 1}</strong>
                <span>{question.type === "true-false" ? "True or false" : "Quiz"}</span>
              </div>
              {quiz.questions.length > 1 ? (
                <button className="text-button" onClick={() => removeQuestion(questionIndex)}>
                  Remove
                </button>
              ) : null}
            </header>
            <div className="question-editor__settings">
              <label>
                <span>Format</span>
                <select value={question.type} onChange={(event) => changeType(questionIndex, event.target.value)}>
                  <option value="quiz">Quiz</option>
                  <option value="true-false">True or false</option>
                </select>
              </label>
              <label>
                <span>Time limit</span>
                <select
                  value={question.seconds}
                  onChange={(event) => updateQuestion(questionIndex, "seconds", Number(event.target.value))}
                >
                  {timePresets.map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds < 60 ? `${seconds} sec` : `${seconds / 60} min`}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Points</span>
                <select
                  value={question.points}
                  onChange={(event) => updateQuestion(questionIndex, "points", Number(event.target.value))}
                >
                  {pointValues.map((points) => (
                    <option key={points} value={points}>
                      {points.toLocaleString()}
                    </option>
                  ))}
                </select>
              </label>
              {question.type === "quiz" ? (
                <label className="toggle-field">
                  <input
                    type="checkbox"
                    checked={question.multiSelect}
                    onChange={(event) => {
                      updateQuestion(questionIndex, "multiSelect", event.target.checked);
                      if (!event.target.checked) {
                        updateQuestion(questionIndex, "correctIndexes", question.correctIndexes.slice(0, 1));
                      }
                    }}
                  />
                  <span>Players can select multiple</span>
                </label>
              ) : null}
            </div>
            <label className="prompt-field">
              <span>Question · {question.prompt.length}/120</span>
              <textarea
                className="question-editor__prompt"
                value={question.prompt}
                maxLength={120}
                rows={2}
                onChange={(event) => updateQuestion(questionIndex, "prompt", event.target.value)}
              />
            </label>
            <div className="media-editor">
              <label>
                <span>Question media</span>
                <select
                  value={question.media?.kind || "none"}
                  onChange={(event) =>
                    updateQuestion(
                      questionIndex,
                      "media",
                      event.target.value === "none" ? null : { kind: event.target.value, url: "" },
                    )
                  }
                >
                  <option value="none">None</option>
                  <option value="image">Image upload</option>
                  <option value="youtube">YouTube link</option>
                  <option value="vimeo">Vimeo link</option>
                </select>
              </label>
              {question.media?.kind === "image" ? (
                <>
                  <ImageUploadButton
                    onUploaded={(url) => updateQuestion(questionIndex, "media", { kind: "image", url })}
                  />
                  {question.media.url ? (
                    <img className="media-editor__preview" src={question.media.url} alt="Question upload" />
                  ) : null}
                </>
              ) : null}
              {["youtube", "vimeo"].includes(question.media?.kind) ? (
                <input
                  type="url"
                  placeholder={`Paste a ${question.media.kind === "youtube" ? "YouTube" : "Vimeo"} link`}
                  value={question.media.url}
                  onChange={(event) =>
                    updateQuestion(questionIndex, "media", {
                      ...question.media,
                      url: event.target.value,
                    })
                  }
                />
              ) : null}
            </div>
            <div className="question-editor__options">
              {question.options.map((option, optionIndex) => (
                <div className={`option-field option-field--${answerColors[optionIndex]}`} key={optionIndex}>
                  <input
                    type={question.multiSelect ? "checkbox" : "radio"}
                    name={`correct-${questionIndex}`}
                    checked={question.correctIndexes.includes(optionIndex)}
                    onChange={() => toggleCorrect(questionIndex, optionIndex)}
                    aria-label={`Mark answer ${optionIndex + 1} as correct`}
                  />
                  <div className="option-field__content">
                    <input
                      value={option.text}
                      readOnly={question.type === "true-false"}
                      maxLength={75}
                      placeholder={option.imageUrl ? "Optional caption" : "Answer text"}
                      onChange={(event) => updateOption(questionIndex, optionIndex, "text", event.target.value)}
                    />
                    {question.type === "quiz" ? (
                      <div className="option-field__media">
                        <ImageUploadButton
                          compact
                          onUploaded={(url) => updateOption(questionIndex, optionIndex, "imageUrl", url)}
                        />
                        {option.imageUrl ? (
                          <>
                            <img src={option.imageUrl} alt="" />
                            <button onClick={() => updateOption(questionIndex, optionIndex, "imageUrl", "")}>
                              Clear image
                            </button>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {question.type === "quiz" && question.options.length > 2 ? (
                    <button
                      className="option-field__remove"
                      aria-label={`Remove answer ${optionIndex + 1}`}
                      onClick={() => removeOption(questionIndex, optionIndex)}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            {question.type === "quiz" && question.options.length < 6 ? (
              <button className="text-button add-answer" onClick={() => addOption(questionIndex)}>
                + Add answer choice
              </button>
            ) : null}
            <p className="editor-hint">
              Mark at least one correct answer. Blank answers without an image will not appear in the game.
            </p>
          </section>
        ))}
      </div>
      <div className="editor__add">
        <button className="button button--outline" onClick={() => addQuestion("quiz")}>
          + Quiz question
        </button>
        <button className="button button--outline" onClick={() => addQuestion("true-false")}>
          + True or false
        </button>
      </div>
    </div>
  );
}

function JoinQr({ url }) {
  const [dataUrl, setDataUrl] = useState("");
  useEffect(() => {
    QRCode.toDataURL(url, { width: 220, margin: 1, color: { dark: "#071730", light: "#fffaf0" } }).then(
      setDataUrl,
    );
  }, [url]);
  return dataUrl ? <img className="join-qr" src={dataUrl} alt={`QR code for ${url}`} /> : null;
}

function Host({ socket }) {
  const [quiz, setQuiz] = useState(() => {
    try {
      const saved = localStorage.getItem("couch-quiz-draft");
      return saved ? migrateQuiz(JSON.parse(saved)) : starterQuiz;
    } catch {
      return starterQuiz;
    }
  });
  const [room, setRoom] = useState(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const onRoomState = (nextRoom) => setRoom(nextRoom);
    const onError = (message) => setError(message);
    socket.on("room:state", onRoomState);
    socket.on("app:error", onError);

    const session = JSON.parse(localStorage.getItem("couch-quiz-host") || "null");
    if (session) {
      socket.emit("host:resume", session, (response) => {
        if (!response?.ok) localStorage.removeItem("couch-quiz-host");
      });
    }
    return () => {
      socket.off("room:state", onRoomState);
      socket.off("app:error", onError);
    };
  }, [socket]);

  useEffect(() => {
    localStorage.setItem("couch-quiz-draft", JSON.stringify(quiz));
  }, [quiz]);

  const createRoom = () => {
    setError("");
    setCreating(true);
    socket.emit("host:create", quiz, (response) => {
      setCreating(false);
      if (!response?.ok) return setError(response?.error || "Could not create the room.");
      localStorage.setItem(
        "couch-quiz-host",
        JSON.stringify({ code: response.code, hostKey: response.hostKey }),
      );
    });
  };

  if (!room) {
    return (
      <main className="setup">
        <header className="setup__header">
          <Brand compact />
          <a className="text-link" href="/play">
            Join instead
          </a>
        </header>
        <section className="setup__intro">
          <div>
            <h1>Build tonight’s quiz.</h1>
            <p>Add flexible quiz rounds or fast true-or-false questions. Your draft saves on this device.</p>
          </div>
          <div className="setup__summary">
            <strong>{quiz.questions.length}</strong>
            <span>questions</span>
          </div>
        </section>
        <QuestionEditor quiz={quiz} setQuiz={setQuiz} />
        <footer className="setup__footer">
          {error ? <p className="error">{error}</p> : <span />}
          <button className="button button--primary" disabled={creating} onClick={createRoom}>
            {creating ? "Opening room..." : "Open the lobby"}
          </button>
        </footer>
      </main>
    );
  }

  const currentQuestion = room.question;
  const nextLabel =
    room.questionIndex >= room.questionCount - 1 ? "Show final podium" : "Next question";

  if (room.phase === "lobby") {
    return (
      <main className="host-stage host-stage--lobby">
        <Decorations />
        <header className="stage-header">
          <Brand compact />
          <div className="room-code">
            <span>ROOM</span>
            <strong>{formatCode(room.code)}</strong>
          </div>
        </header>
        <section className="lobby">
          <div className="lobby__join">
            <p>Scan to join</p>
            <JoinQr url={room.joinUrl} />
            <strong>{room.joinUrl.replace(/^https?:\/\//, "")}</strong>
          </div>
          <div className="lobby__players">
            <span className="section-label">ON THE COUCH</span>
            <h1>{room.players.length ? `${room.players.length} ready to play` : "Waiting for players"}</h1>
            <div className="player-cloud">
              {room.players.map((player, index) => (
                <span className={`player-chip player-chip--${answerColors[index % answerColors.length]}`} key={player.id}>
                  {player.name}
                </span>
              ))}
            </div>
            <button
              className="button button--primary button--huge"
              disabled={!room.players.length}
              onClick={() => socket.emit("host:start", { code: room.code })}
            >
              Start the quiz
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (room.phase === "finished") {
    return (
      <main className="host-stage host-stage--finished">
        <Decorations />
        <Brand compact />
        <section className="podium">
          <p className="section-label">FINAL SCORES</p>
          <h1>Make some noise for the couch champions.</h1>
          <Leaderboard players={room.players} podium />
          <button
            className="button button--light"
            onClick={() => {
              localStorage.removeItem("couch-quiz-host");
              window.location.reload();
            }}
          >
            Make another quiz
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className={`host-stage host-stage--${room.phase}`}>
      <Decorations />
      <header className="stage-header">
        <Brand compact />
        <div className="question-count">
          Question <strong>{room.questionIndex + 1}</strong> / {room.questionCount}
          <span>{currentQuestion.points.toLocaleString()} pts</span>
        </div>
        <div className="room-code room-code--small">
          <span>ROOM</span>
          <strong>{formatCode(room.code)}</strong>
        </div>
      </header>
      <section className="score-strip">
        <Leaderboard players={room.players} />
      </section>
      <section className={`question-board ${currentQuestion.media ? "question-board--with-media" : ""}`}>
        <div className="question-board__heading">
          <Timer value={room.secondsLeft} total={currentQuestion.seconds} />
          <div className="question-board__content">
            <h1>{currentQuestion.prompt}</h1>
            <QuestionMedia media={currentQuestion.media} />
          </div>
        </div>
        <AnswerGrid
          options={currentQuestion.options}
          disabled
          correctIndexes={currentQuestion.correctIndexes}
        />
      </section>
      <footer className="stage-footer">
        <div className="answered-count">
          <strong>
            {room.answeredCount} of {room.playerCount}
          </strong>
          <span>answered</span>
        </div>
        {room.phase === "question" ? (
          <button className="button button--light" onClick={() => socket.emit("host:reveal", { code: room.code })}>
            Reveal now
          </button>
        ) : (
          <button className="button button--primary" onClick={() => socket.emit("host:next", { code: room.code })}>
            {nextLabel}
          </button>
        )}
      </footer>
    </main>
  );
}

function Player({ socket }) {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [code, setCode] = useState(() => formatCode(params.get("room") || ""));
  const [name, setName] = useState(() => localStorage.getItem("couch-quiz-name") || "");
  const [room, setRoom] = useState(null);
  const [player, setPlayer] = useState(null);
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);
  const [pendingIndexes, setPendingIndexes] = useState([]);

  useEffect(() => {
    setPendingIndexes([]);
  }, [room?.questionIndex]);

  const join = () => {
    setError("");
    setJoining(true);
    const normalizedCode = code.replace(/\D/g, "");
    const playerKey = localStorage.getItem(`couch-quiz-player-${normalizedCode}`);
    socket.emit("player:join", { code: normalizedCode, name, playerKey }, (response) => {
      setJoining(false);
      if (!response?.ok) return setError(response?.error || "Could not join.");
      localStorage.setItem("couch-quiz-name", name.trim());
      localStorage.setItem(`couch-quiz-player-${normalizedCode}`, response.playerKey);
    });
  };

  useEffect(() => {
    const onRoomState = (nextRoom) => setRoom(nextRoom);
    const onPlayerState = (nextPlayer) => setPlayer(nextPlayer);
    socket.on("room:state", onRoomState);
    socket.on("player:state", onPlayerState);
    return () => {
      socket.off("room:state", onRoomState);
      socket.off("player:state", onPlayerState);
    };
  }, [socket]);

  if (!room || !player) {
    return (
      <main className="join">
        <Decorations />
        <section className="join__panel">
          <Brand />
          <h1>Grab a spot on the couch.</h1>
          <label className="field">
            <span>Room code</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000 000"
              value={code}
              onChange={(event) => setCode(formatCode(event.target.value))}
            />
          </label>
          <label className="field">
            <span>Your name</span>
            <input
              autoComplete="nickname"
              placeholder="Maya"
              maxLength={20}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button
            className="button button--primary button--huge"
            disabled={joining || code.replace(/\D/g, "").length !== 6 || !name.trim()}
            onClick={join}
          >
            {joining ? "Joining..." : "Join the game"}
          </button>
          <a href="/host" className="text-link">
            Hosting instead?
          </a>
        </section>
      </main>
    );
  }

  const rank = room.players.findIndex((item) => item.id === player.id) + 1;

  if (room.phase === "lobby") {
    return (
      <main className="player-screen player-screen--waiting">
        <Decorations />
        <PlayerHeader player={player} rank={rank} />
        <section className="waiting-card">
          <span className="waiting-card__check">✓</span>
          <h1>You’re in, {player.name}.</h1>
          <p>Look up at the host screen. The quiz will start soon.</p>
        </section>
      </main>
    );
  }

  if (room.phase === "finished") {
    return (
      <main className="player-screen player-screen--finished">
        <Decorations />
        <PlayerHeader player={player} rank={rank} />
        <section className="player-finish">
          <span className="section-label">FINAL PLACE</span>
          <strong>#{rank}</strong>
          <h1>{rank === 1 ? "Couch champion!" : "Excellent work."}</h1>
          <p>{player.score.toLocaleString()} points</p>
        </section>
      </main>
    );
  }

  const isReveal = room.phase === "reveal";
  const locked = Array.isArray(player.selectedIndexes);
  const selectedIndexes = locked ? player.selectedIndexes : pendingIndexes;

  const selectAnswer = (index) => {
    if (room.question.multiSelect) {
      setPendingIndexes((current) =>
        current.includes(index) ? current.filter((item) => item !== index) : [...current, index],
      );
    } else {
      setPendingIndexes([index]);
      socket.emit("player:answer", { code: room.code, indexes: [index] });
    }
  };

  return (
    <main className={`player-screen player-screen--${room.phase}`}>
      <Decorations />
      <PlayerHeader player={player} rank={rank} />
      <section className="player-question">
        <Timer value={room.secondsLeft} total={room.question.seconds} compact />
        <p className="player-question__prompt">
          {isReveal
            ? player.lastResult?.correct
              ? `Correct! +${player.lastResult.points}`
              : "Not this time"
            : locked
              ? "Answer locked!"
              : room.question.multiSelect
                ? "Select all that apply"
                : "Choose your answer"}
        </p>
        <AnswerGrid
          options={room.question.options}
          selectedIndexes={selectedIndexes}
          correctIndexes={room.question.correctIndexes}
          disabled={locked || isReveal}
          player
          onSelect={selectAnswer}
        />
        {room.question.multiSelect && !locked && !isReveal ? (
          <button
            className="button button--primary player-submit"
            disabled={!pendingIndexes.length}
            onClick={() => socket.emit("player:answer", { code: room.code, indexes: pendingIndexes })}
          >
            Lock in {pendingIndexes.length || ""} answer{pendingIndexes.length === 1 ? "" : "s"}
          </button>
        ) : null}
        {isReveal ? (
          <div className="player-result">
            <strong>{player.streak ? `${player.streak} answer streak` : "Next one is yours"}</strong>
            <span>Look up for the leaderboard</span>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function PlayerHeader({ player, rank }) {
  return (
    <header className="player-header">
      <Brand compact />
      <div>
        <strong>{player.name}</strong>
        <span>
          {player.score.toLocaleString()} pts · #{rank || "–"}
        </span>
      </div>
    </header>
  );
}

export default function App({ socket }) {
  const path = window.location.pathname;
  if (path.startsWith("/host")) return <Host socket={socket} />;
  if (path.startsWith("/play")) return <Player socket={socket} />;
  return <Home />;
}
