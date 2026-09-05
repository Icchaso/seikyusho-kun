/**
 * メール送信。Resend と SMTP の2つに対応する。
 * どちらも「希望する人だけ」使うので、パッケージは optionalDependencies にして
 * 実際に送るときだけ読み込む。
 */
import fs from "node:fs";
import path from "node:path";
import type { Config } from "../core/types.js";
import { getSecret } from "../core/env.js";

export interface SendRequest {
  to: string;
  bcc?: string;
  subject: string;
  text: string;
  attachmentPath?: string;
  fromName: string;
  fromEmail: string;
}

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/** 送る前に設定が揃っているかを確かめる。足りなければ理由を返す */
export function checkMailReady(config: Config): string | null {
  const mail = config.mail;
  if (!mail) {
    return "メール送信が未設定です。`seikyusho-kun send --setup` で設定してください。";
  }
  if (!mail.fromEmail) {
    return "差出人アドレスが未設定です。`seikyusho-kun send --setup` で設定してください。";
  }
  if (mail.provider === "resend") {
    if (!getSecret("RESEND_API_KEY")) {
      return "RESEND_API_KEY が見つかりません。`seikyusho-kun send --setup` で登録してください。";
    }
  } else {
    if (!mail.smtp?.host) return "SMTPサーバーが未設定です。";
    if (!getSecret("SMTP_USER") || !getSecret("SMTP_PASS")) {
      return "SMTP のユーザー名かパスワードが見つかりません。`seikyusho-kun send --setup` で登録してください。";
    }
  }
  return null;
}

async function sendWithResend(req: SendRequest): Promise<SendResult> {
  let Resend: typeof import("resend").Resend;
  try {
    ({ Resend } = await import("resend"));
  } catch {
    return {
      ok: false,
      error: "resend パッケージが入っていません。`npm i resend` を実行してください。",
    };
  }

  const client = new Resend(getSecret("RESEND_API_KEY") as string);
  const attachments = req.attachmentPath
    ? [
        {
          filename: path.basename(req.attachmentPath),
          content: fs.readFileSync(req.attachmentPath).toString("base64"),
        },
      ]
    : undefined;

  const { data, error } = await client.emails.send({
    from: `${req.fromName} <${req.fromEmail}>`,
    to: [req.to],
    ...(req.bcc ? { bcc: [req.bcc] } : {}),
    subject: req.subject,
    text: req.text,
    ...(attachments ? { attachments } : {}),
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, ...(data?.id ? { id: data.id } : {}) };
}

async function sendWithSmtp(
  req: SendRequest,
  smtp: { host: string; port: number; secure?: boolean },
): Promise<SendResult> {
  let nodemailer: typeof import("nodemailer");
  try {
    nodemailer = (await import("nodemailer")).default;
  } catch {
    return {
      ok: false,
      error: "nodemailer パッケージが入っていません。`npm i nodemailer` を実行してください。",
    };
  }

  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure ?? smtp.port === 465,
    auth: {
      user: getSecret("SMTP_USER") as string,
      pass: getSecret("SMTP_PASS") as string,
    },
  });

  try {
    const info = await transport.sendMail({
      from: { name: req.fromName, address: req.fromEmail },
      to: req.to,
      ...(req.bcc ? { bcc: req.bcc } : {}),
      subject: req.subject,
      text: req.text,
      ...(req.attachmentPath
        ? {
            attachments: [
              {
                filename: path.basename(req.attachmentPath),
                path: req.attachmentPath,
              },
            ],
          }
        : {}),
    });
    return { ok: true, id: info.messageId };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function sendMail(
  config: Config,
  req: SendRequest,
): Promise<SendResult> {
  const problem = checkMailReady(config);
  if (problem) return { ok: false, error: problem };

  if (config.mail?.provider === "smtp") {
    return sendWithSmtp(req, config.mail.smtp as { host: string; port: number });
  }
  return sendWithResend(req);
}
