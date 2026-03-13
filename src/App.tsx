import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "./lib/supabase";
import "./App.css";

type Participant = {
  id: string;
  discord_username: string;
  score: number;
  joined_at: string;
};

type EventSettings = {
  id: string;
  event_name: string;
  registration_start: string;
  registration_end: string;
  quiz_start: string;
  quiz_end: string;
  is_live: boolean;
  created_at: string;
};

type Question = {
  id: string;
  question_order: number;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: "A" | "B" | "C" | "D";
};

type LeaderboardEntry = {
  id: string;
  discord_username: string;
  score: number;
  joined_at: string;
};

type AnswerRow = {
  participant_id: string;
  question_id: string;
};

const PARTICIPANT_STORAGE_KEY = "monad_meetup_participant";
const ADMIN_SESSION_KEY = "monad_meetup_admin_session";

const ADMIN_USERNAME = import.meta.env.VITE_ADMIN_USERNAME;
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD;

function formatCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function getPhase(eventSettings: EventSettings | null, now: number) {
  if (!eventSettings) return "no-event";

  const quizStart = new Date(eventSettings.quiz_start).getTime();
  const quizEnd = new Date(eventSettings.quiz_end).getTime();

  if (now < quizStart) return "waiting";
  if (now >= quizStart && now < quizEnd) return "quiz-live";
  if (now >= quizEnd) return "quiz-ended";

  return "waiting";
}

function toIsoString(date: Date) {
  return date.toISOString();
}

export default function App() {
  const [discordUsername, setDiscordUsername] = useState("");
  const [adminPasswordInput, setAdminPasswordInput] = useState("");
  const [isAdminCandidate, setIsAdminCandidate] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [participant, setParticipant] = useState<Participant | null>(null);
  const [eventSettings, setEventSettings] = useState<EventSettings | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [answersMap, setAnswersMap] = useState<Record<string, "A" | "B" | "C" | "D">>({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<"A" | "B" | "C" | "D" | "">("");
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [submittingAnswer, setSubmittingAnswer] = useState(false);
  const [adminActionLoading, setAdminActionLoading] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(Date.now());
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const [quizCompleted, setQuizCompleted] = useState(false);
  const [userRank, setUserRank] = useState<number | null>(null);
  const [submittedCount, setSubmittedCount] = useState(0);

  useEffect(() => {
    const savedParticipant = localStorage.getItem(PARTICIPANT_STORAGE_KEY);
    if (savedParticipant) {
      try {
        setParticipant(JSON.parse(savedParticipant));
      } catch {
        localStorage.removeItem(PARTICIPANT_STORAGE_KEY);
      }
    }

    const savedAdmin = localStorage.getItem(ADMIN_SESSION_KEY);
    if (savedAdmin === "true") {
      setIsAdmin(true);
    }
  }, []);

  const loadEventAndQuestions = async () => {
    const [{ data: liveEvent, error: eventError }, { data: quizQuestions, error: questionsError }] =
      await Promise.all([
        supabase
          .from("event_settings")
          .select("*")
          .eq("is_live", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from("questions").select("*").order("question_order", { ascending: true }),
      ]);

    if (eventError) {
      setMessage(eventError.message);
    } else {
      setEventSettings(liveEvent);
    }

    if (questionsError) {
      setMessage(questionsError.message);
    } else {
      setQuestions(quizQuestions || []);
    }
  };

  const loadLeaderboardAndSubmissionStatus = async () => {
    const { data: participantsData, error: participantsError } = await supabase
      .from("participants")
      .select("id, discord_username, score, joined_at")
      .order("score", { ascending: false })
      .order("joined_at", { ascending: true });

    if (!participantsError && participantsData) {
      setLeaderboard(participantsData);

      if (participant) {
        const rankIndex = participantsData.findIndex((entry) => entry.id === participant.id);
        setUserRank(rankIndex >= 0 ? rankIndex + 1 : null);
      }
    }

    if (questions.length > 0) {
      const { data: answersData, error: answersError } = await supabase
        .from("answers")
        .select("participant_id, question_id");

      if (!answersError && answersData) {
        const answerCountByUser: Record<string, number> = {};

        (answersData as AnswerRow[]).forEach((row) => {
          answerCountByUser[row.participant_id] =
            (answerCountByUser[row.participant_id] || 0) + 1;
        });

        const finishedUsers = Object.values(answerCountByUser).filter(
          (count) => count >= questions.length
        ).length;

        setSubmittedCount(finishedUsers);
      } else {
        setSubmittedCount(0);
      }
    } else {
      setSubmittedCount(0);
    }
  };

  const refreshAll = async () => {
    await loadEventAndQuestions();
  };

  useEffect(() => {
    const initialLoad = async () => {
      setPageLoading(true);
      setMessage("");
      await refreshAll();
      setPageLoading(false);
    };

    initialLoad();

    const interval = setInterval(() => {
      refreshAll();
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (participant) {
      localStorage.setItem(PARTICIPANT_STORAGE_KEY, JSON.stringify(participant));
    }
  }, [participant]);

  useEffect(() => {
    if (isAdmin) {
      localStorage.setItem(ADMIN_SESSION_KEY, "true");
    } else {
      localStorage.removeItem(ADMIN_SESSION_KEY);
    }
  }, [isAdmin]);

  useEffect(() => {
    loadLeaderboardAndSubmissionStatus();

    const interval = setInterval(() => {
      loadLeaderboardAndSubmissionStatus();
    }, 2000);

    return () => clearInterval(interval);
  }, [participant, questions]);

  const phase = useMemo(() => getPhase(eventSettings, now), [eventSettings, now]);

  const countdownText = useMemo(() => {
    if (!eventSettings) return "00:00";

    const quizStart = new Date(eventSettings.quiz_start).getTime();
    const quizEnd = new Date(eventSettings.quiz_end).getTime();

    if (phase === "waiting") {
      return formatCountdown(quizStart - now);
    }

    if (phase === "quiz-live") {
      return formatCountdown(quizEnd - now);
    }

    return "00:00";
  }, [eventSettings, phase, now]);

  const currentQuestion = questions[currentQuestionIndex] || null;

  const computedScore = useMemo(() => {
    return questions.reduce((acc, question) => {
      return acc + (answersMap[question.id] === question.correct_option ? 1 : 0);
    }, 0);
  }, [questions, answersMap]);

  const totalParticipants = leaderboard.length;

  const canShowRank =
    phase === "quiz-ended" ||
    (totalParticipants > 0 && submittedCount >= totalParticipants);

  useEffect(() => {
    const loadExistingAnswers = async () => {
      if (!participant || questions.length === 0) return;

      const { data, error } = await supabase
        .from("answers")
        .select("question_id, selected_option")
        .eq("participant_id", participant.id);

      if (error || !data) return;

      const restoredAnswers: Record<string, "A" | "B" | "C" | "D"> = {};

      data.forEach((item) => {
        restoredAnswers[item.question_id] = item.selected_option as "A" | "B" | "C" | "D";
      });

      setAnswersMap(restoredAnswers);

      const answeredCount = data.length;

      if (answeredCount >= questions.length) {
        const restoredScore = questions.reduce((acc, q) => {
          return acc + (restoredAnswers[q.id] === q.correct_option ? 1 : 0);
        }, 0);
        setQuizCompleted(true);
        setFinalScore(restoredScore);
      } else {
        setCurrentQuestionIndex(answeredCount);
      }
    };

    loadExistingAnswers();
  }, [participant, questions]);

  useEffect(() => {
    if (
      (phase === "quiz-ended" || canShowRank) &&
      participant &&
      !quizCompleted &&
      questions.length > 0
    ) {
      const score = questions.reduce((acc, question) => {
        return acc + (answersMap[question.id] === question.correct_option ? 1 : 0);
      }, 0);

      setFinalScore(score);
      setQuizCompleted(true);

      supabase.from("participants").update({ score }).eq("id", participant.id);
    }
  }, [phase, canShowRank, participant, quizCompleted, questions, answersMap]);

  const handleJoin = async (e: FormEvent) => {
    e.preventDefault();

    const trimmedUsername = discordUsername.trim();

    if (!trimmedUsername) {
      setMessage("Please enter your Discord username.");
      return;
    }

    if (trimmedUsername.toLowerCase() === ADMIN_USERNAME?.toLowerCase()) {
      setIsAdminCandidate(true);
      setMessage("");
      return;
    }

    if (phase !== "waiting") {
      setMessage("Joining is closed once the quiz has started or ended.");
      return;
    }

    setLoading(true);
    setMessage("");

    const { data, error } = await supabase
      .from("participants")
      .insert([{ discord_username: trimmedUsername }])
      .select()
      .single();

    if (error) {
      if (error.message.toLowerCase().includes("duplicate")) {
        setMessage("This Discord username is already registered.");
      } else {
        setMessage(error.message);
      }
      setLoading(false);
      return;
    }

    setParticipant(data);
    setLoading(false);
  };

  const handleAdminLogin = (e: FormEvent) => {
    e.preventDefault();

    if (adminPasswordInput !== ADMIN_PASSWORD) {
      setMessage("Wrong admin password.");
      return;
    }

    setIsAdmin(true);
    setIsAdminCandidate(false);
    setAdminPasswordInput("");
    setMessage("");
  };

  const handleSubmitAnswer = async () => {
    if (!participant || !currentQuestion || !selectedOption) return;

    setSubmittingAnswer(true);
    setMessage("");

    const isCorrect = selectedOption === currentQuestion.correct_option;

    const { error } = await supabase.from("answers").upsert(
      [
        {
          participant_id: participant.id,
          question_id: currentQuestion.id,
          selected_option: selectedOption,
          is_correct: isCorrect,
        },
      ],
      { onConflict: "participant_id,question_id" }
    );

    if (error) {
      setMessage(error.message);
      setSubmittingAnswer(false);
      return;
    }

    const updatedAnswers = {
      ...answersMap,
      [currentQuestion.id]: selectedOption,
    };

    setAnswersMap(updatedAnswers);
    setSelectedOption("");

    const isLastQuestion = currentQuestionIndex === questions.length - 1;

    if (isLastQuestion) {
      const score = questions.reduce((acc, question) => {
        const chosen =
          question.id === currentQuestion.id
            ? selectedOption
            : updatedAnswers[question.id];
        return acc + (chosen === question.correct_option ? 1 : 0);
      }, 0);

      const { data: updatedParticipant, error: updateScoreError } = await supabase
        .from("participants")
        .update({ score })
        .eq("id", participant.id)
        .select()
        .single();

      if (updateScoreError) {
        setMessage(updateScoreError.message);
      } else if (updatedParticipant) {
        setParticipant(updatedParticipant);
      }

      setFinalScore(score);
      setQuizCompleted(true);
      setSubmittingAnswer(false);
      return;
    }

    setCurrentQuestionIndex((prev) => prev + 1);
    setSubmittingAnswer(false);
  };

  const updateEventTimes = async (payload: Partial<EventSettings>) => {
    if (!eventSettings) return;

    setAdminActionLoading(true);
    setMessage("");

    const { error } = await supabase
      .from("event_settings")
      .update(payload)
      .eq("id", eventSettings.id);

    if (error) {
      setMessage(error.message);
      setAdminActionLoading(false);
      return;
    }

    await refreshAll();
    await loadLeaderboardAndSubmissionStatus();
    setAdminActionLoading(false);
  };

  const handleOpenJoinMode = async () => {
    const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const futureEnd = new Date(futureStart.getTime() + 10 * 60 * 1000);

    await updateEventTimes({
      quiz_start: toIsoString(futureStart),
      quiz_end: toIsoString(futureEnd),
      is_live: true,
    });
  };

  const handleStartQuizNow = async () => {
    const start = new Date();
    const quizEnd = new Date(start.getTime() + 10 * 60 * 1000);

    await updateEventTimes({
      quiz_start: toIsoString(start),
      quiz_end: toIsoString(quizEnd),
      is_live: true,
    });
  };

  const handleEndQuizNow = async () => {
    const end = new Date();

    await updateEventTimes({
      quiz_end: toIsoString(end),
      is_live: true,
    });
  };

  const handleClearLeaderboard = async () => {
    if (!showResetConfirm) {
      setShowResetConfirm(true);
      setMessage(
        "Warning: this will delete all participants, answers, ranks, and scores. Press confirm reset to continue."
      );
      return;
    }

    setAdminActionLoading(true);
    setMessage("");

    const { error } = await supabase
      .from("participants")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (error) {
      setMessage(error.message);
      setAdminActionLoading(false);
      return;
    }

    setLeaderboard([]);
    setSubmittedCount(0);
    setShowResetConfirm(false);

    const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const futureEnd = new Date(futureStart.getTime() + 10 * 60 * 1000);

    const { error: eventError } = await supabase
      .from("event_settings")
      .update({
        quiz_start: toIsoString(futureStart),
        quiz_end: toIsoString(futureEnd),
        is_live: true,
      })
      .eq("id", eventSettings?.id);

    if (eventError) {
      setMessage(eventError.message);
      setAdminActionLoading(false);
      return;
    }

    setMessage("Leaderboard and participant data cleared. Quiz reset to waiting mode.");
    await refreshAll();
    await loadLeaderboardAndSubmissionStatus();
    setAdminActionLoading(false);
  };

  const handleCancelReset = () => {
    setShowResetConfirm(false);
    setMessage("");
  };

  const handleAdminLogout = () => {
    setIsAdmin(false);
    setIsAdminCandidate(false);
    setAdminPasswordInput("");
    setShowResetConfirm(false);
    setMessage("");
  };

  const handleResetSession = () => {
    localStorage.removeItem(PARTICIPANT_STORAGE_KEY);
    setParticipant(null);
    setDiscordUsername("");
    setAnswersMap({});
    setCurrentQuestionIndex(0);
    setSelectedOption("");
    setFinalScore(null);
    setQuizCompleted(false);
    setMessage("");
    setUserRank(null);
  };

  if (pageLoading) {
    return (
      <div className="centerPage">
        <div className="cardSmall">
          <h1 className="title">Loading event...</h1>
        </div>
      </div>
    );
  }

  if (!eventSettings) {
    return (
      <div className="centerPage">
        <div className="cardSmall">
          <div className="eyebrow">Monad Meetup Quiz</div>
          <h1 className="title">No active event found</h1>
          <p className="subtitle">Add one live row in event_settings to continue.</p>
        </div>
      </div>
    );
  }

  if (isAdmin) {
    return (
      <div className="page">
        <div className="card">
          <div className="eyebrow">Admin Dashboard</div>
          <h1 className="title">Quiz Control Panel</h1>
          <p className="subtitle">
            Current phase: <strong>{phase}</strong>
          </p>

          <div className="row">
            <div className="timerBox">
              <div className="timerLabel">Countdown</div>
              <div className="timerValue">{countdownText}</div>
            </div>

            <div className="timerBox">
              <div className="timerLabel">Participants</div>
              <div className="timerValue">{leaderboard.length}</div>
            </div>
          </div>

          <div className="options" style={{ marginBottom: 24 }}>
            <button className="button" onClick={handleOpenJoinMode} disabled={adminActionLoading}>
              {adminActionLoading ? "Working..." : "Open Join Mode"}
            </button>

            <button className="button" onClick={handleStartQuizNow} disabled={adminActionLoading}>
              {adminActionLoading ? "Working..." : "Start Quiz Now"}
            </button>

            <button className="button" onClick={handleEndQuizNow} disabled={adminActionLoading}>
              {adminActionLoading ? "Working..." : "End Quiz Now"}
            </button>

            {!showResetConfirm ? (
              <button className="button" onClick={handleClearLeaderboard} disabled={adminActionLoading}>
                {adminActionLoading ? "Working..." : "Reset Leaderboard"}
              </button>
            ) : (
              <>
                <button className="button" onClick={handleClearLeaderboard} disabled={adminActionLoading}>
                  {adminActionLoading ? "Working..." : "Confirm Reset"}
                </button>

                <button className="secondaryButton" onClick={handleCancelReset} disabled={adminActionLoading}>
                  Cancel Reset
                </button>
              </>
            )}
          </div>

          <div className="questionBox">
            <h2 className="questionTitle" style={{ marginBottom: 12 }}>Live Results</h2>

            {leaderboard.length === 0 ? (
              <p className="subtitle">No participant data yet.</p>
            ) : (
              <div className="leaderboard">
                {leaderboard.map((entry, index) => (
                  <div key={entry.id} className="leaderboardItem">
                    <div className="rankWrap">
                      <div className="rank">{index + 1}</div>
                      <div className="name">{entry.discord_username}</div>
                    </div>
                    <div className="score">{entry.score}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button className="secondaryButton" onClick={handleAdminLogout}>
            Logout Admin
          </button>

          {message && <p className="message">{message}</p>}
        </div>
      </div>
    );
  }

  if (isAdminCandidate) {
    return (
      <div className="centerPage">
        <div className="cardSmall">
          <div className="eyebrow">Admin Access</div>
          <h1 className="title">Enter admin password</h1>
          <p className="subtitle">Restricted panel.</p>

          <form onSubmit={handleAdminLogin}>
            <input
              className="input"
              type="password"
              placeholder="Enter admin password"
              value={adminPasswordInput}
              onChange={(e) => setAdminPasswordInput(e.target.value)}
            />

            <button className="button" type="submit">
              Enter Dashboard
            </button>
          </form>

          <button
            className="secondaryButton"
            onClick={() => {
              setIsAdminCandidate(false);
              setDiscordUsername("");
              setAdminPasswordInput("");
              setMessage("");
            }}
          >
            Back
          </button>

          {message && <p className="message">{message}</p>}
        </div>
      </div>
    );
  }

  if (!participant) {
    return (
      <div className="centerPage">
        <div className="cardSmall">
          <div className="eyebrow">{eventSettings.event_name}</div>
          <h1 className="title">Enter your Discord username</h1>
          <p className="subtitle">
            Join before the admin starts the quiz. Your score will be saved.
          </p>

          {phase === "waiting" && (
            <p className="noticeGreen">Join mode is open. Admin has not started the quiz yet.</p>
          )}

          {phase === "quiz-live" && (
            <p className="noticeRed">Quiz is live. New joining is closed.</p>
          )}

          {phase === "quiz-ended" && (
            <p className="noticeMuted">Quiz has ended.</p>
          )}

          <form onSubmit={handleJoin}>
            <input
              className="input"
              type="text"
              placeholder="example: growthmindsetgg"
              value={discordUsername}
              onChange={(e) => setDiscordUsername(e.target.value)}
            />

            <button
              className="button"
              type="submit"
              disabled={
                loading ||
                (phase !== "waiting" &&
                  discordUsername.trim().toLowerCase() !== ADMIN_USERNAME?.toLowerCase())
              }
            >
              {loading ? "Joining..." : "Join Quiz"}
            </button>
          </form>

          {message && <p className="message">{message}</p>}
        </div>
      </div>
    );
  }

  if (phase !== "quiz-live" || quizCompleted) {
    return (
      <div className="page">
        <div className="card">
          <div className="eyebrow">{eventSettings.event_name}</div>
          <h1 className="title">{phase === "quiz-ended" || quizCompleted ? "Quiz Status" : "Waiting Room"}</h1>

          <p className="subtitle">
            Discord Username: <strong>{participant.discord_username}</strong>
          </p>

          {phase === "waiting" && (
            <p className="subtitle">You are registered. Waiting for admin to start the quiz.</p>
          )}

          {phase === "quiz-live" && quizCompleted && !canShowRank && (
            <>
              <p className="noticeGreen">You have completed the quiz.</p>
              <p className="subtitle">
                Your score: <strong>{finalScore ?? computedScore}</strong> / {questions.length}
              </p>
              <p className="subtitle">Rank will appear once all users submit or admin ends the quiz.</p>
            </>
          )}

          {(phase === "quiz-ended" || canShowRank) && (
            <>
              <p className="subtitle">
                {phase === "quiz-ended"
                  ? "Quiz has ended."
                  : "All participants have submitted."}
              </p>
              <p className="subtitle">
                Your score: <strong>{finalScore ?? participant.score}</strong> / {questions.length}
              </p>
              <p className="subtitle">
                Your rank: <strong>{userRank ?? "-"}</strong>
              </p>
            </>
          )}

          <button className="secondaryButton" onClick={handleResetSession}>
            Reset Local Session
          </button>

          {message && <p className="message">{message}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="card">
        <div className="row">
          <div>
            <div className="eyebrow">{eventSettings.event_name}</div>
            <h1 className="title">Live Quiz</h1>
            <p className="subtitle">
              Participant: <strong>{participant.discord_username}</strong>
            </p>
          </div>

          <div className="timerBox">
            <div className="timerLabel">Time left</div>
            <div className="timerValue">{countdownText}</div>
          </div>
        </div>

        {currentQuestion ? (
          <>
            <div className="questionMeta">
              <span>
                Question {currentQuestionIndex + 1} of {questions.length}
              </span>
              <span>Current score: {computedScore}</span>
            </div>

            <div className="questionBox">
              <h2 className="questionTitle">{currentQuestion.question_text}</h2>
            </div>

            <div className="options">
              {[
                { key: "A", text: currentQuestion.option_a },
                { key: "B", text: currentQuestion.option_b },
                { key: "C", text: currentQuestion.option_c },
                { key: "D", text: currentQuestion.option_d },
              ].map((option) => (
                <button
                  key={option.key}
                  onClick={() => setSelectedOption(option.key as "A" | "B" | "C" | "D")}
                  className={selectedOption === option.key ? "optionButton active" : "optionButton"}
                >
                  <span className="optionKey">{option.key}.</span>
                  {option.text}
                </button>
              ))}
            </div>

            <button
              className="button"
              onClick={handleSubmitAnswer}
              disabled={!selectedOption || submittingAnswer}
              style={{ marginTop: "24px" }}
            >
              {submittingAnswer
                ? "Submitting..."
                : currentQuestionIndex === questions.length - 1
                ? "Finish Quiz"
                : "Next Question"}
            </button>
          </>
        ) : (
          <p className="subtitle">No questions found.</p>
        )}

        {message && <p className="message">{message}</p>}
      </div>
    </div>
  );
}