// M6-T4 — Faq block, email-safe render (spec §1 table: "Safe, as-is" — the
// web block already renders all three Q/A pairs fully expanded, no
// accordion/JS toggle exists on the web either, so nothing degrades here).
import "server-only";

import { emailBlockCard, EMAIL_BLOCK_COLORS } from "./styles";
import { escapedLongText, escapedShortText } from "./text-utils";

interface FaqPair {
  question: string;
  answer: string;
}

function resolvePairs(props: Record<string, unknown>): FaqPair[] {
  return [
    [props.questionOne, props.answerOne],
    [props.questionTwo, props.answerTwo],
    [props.questionThree, props.answerThree],
  ]
    .map(([question, answer]) => ({
      question: escapedShortText(question),
      answer: escapedLongText(answer),
    }))
    .filter((pair) => pair.question.length > 0 || pair.answer.length > 0);
}

export function renderFaqBlockHtml(props: Record<string, unknown>): string {
  const title = escapedShortText(props.title);
  const pairs = resolvePairs(props);

  const headHtml = title
    ? `<h2 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:${EMAIL_BLOCK_COLORS.heading};">${title}</h2>`
    : "";

  const rowsHtml = pairs
    .map(
      (pair) =>
        `<tr><td style="padding:14px 0;border-top:1px solid ${EMAIL_BLOCK_COLORS.border};">` +
        (pair.question
          ? `<p style="margin:0 0 4px 0;font-size:15px;font-weight:700;color:${EMAIL_BLOCK_COLORS.heading};">${pair.question}</p>`
          : "") +
        (pair.answer
          ? `<p style="margin:0;font-size:14px;line-height:1.7;color:${EMAIL_BLOCK_COLORS.body};">${pair.answer}</p>`
          : "") +
        `</td></tr>`,
    )
    .join("");

  const pairsHtml = rowsHtml
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${rowsHtml}</table>`
    : "";

  return emailBlockCard(`${headHtml}${pairsHtml}`);
}

export function faqBlockTextLines(props: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const title = typeof props.title === "string" ? props.title.trim() : "";
  if (title) lines.push(title);
  for (const [rawQuestion, rawAnswer] of [
    [props.questionOne, props.answerOne],
    [props.questionTwo, props.answerTwo],
    [props.questionThree, props.answerThree],
  ]) {
    const question = typeof rawQuestion === "string" ? rawQuestion.trim() : "";
    const answer = typeof rawAnswer === "string" ? rawAnswer.trim() : "";
    if (question) lines.push(question);
    if (answer) lines.push(answer);
  }
  return lines;
}
