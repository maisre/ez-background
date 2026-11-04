import { Inject, Injectable, Logger } from "@nestjs/common";
import * as Sentry from "@sentry/nestjs";
import { Resend, type ErrorResponse } from "resend";
import { Model } from "mongoose";

/**
 * Thrown when a send failed for a reason that may clear up on its own. The
 * handler lets it escape, so SQS keeps the message and redelivers it after the
 * visibility timeout (and, with a redrive policy, parks it in the DLQ).
 */
export class RetryableEmailError extends Error {}

/**
 * Whether a Resend error is worth retrying.
 *
 * Retry: no status (the request never completed), 429 (rate limit and the
 * daily/monthly quotas), 5xx, and 401/403. The last two are our configuration
 * — a bad API key or an unverified sending domain — not anything wrong with
 * this message, so dropping would lose every email until someone noticed;
 * retrying holds them until the config is fixed.
 *
 * Everything else (422 validation_error for a malformed recipient, missing
 * fields, ...) fails the same way every time, so it is dropped.
 */
export function isRetryableResendError(error: ErrorResponse): boolean {
  const status = error.statusCode;
  if (status === null || status === undefined) return true;
  return status === 401 || status === 403 || status === 429 || status >= 500;
}

interface Org {
  name: string;
  members: Array<{ user: any; role: string }>;
}

interface User {
  email: string;
}

@Injectable()
export class EmailService {
  private readonly resend: Resend;
  private readonly logger = new Logger(EmailService.name);
  private readonly from = "EZ Snippet <noreply@mail.ez-snippets.com>";

  constructor(
    @Inject("RESEND_API_KEY") private readonly apiKey: string,
    @Inject("ORG_MODEL") private readonly orgModel: Model<Org>,
    @Inject("USER_MODEL") private readonly userModel: Model<User>
  ) {
    this.resend = new Resend(this.apiKey);
  }

  /**
   * @param idempotencyKey the SQS message id. Passed to Resend so a redelivery
   *   after a send that actually went through (e.g. a timeout on the response)
   *   doesn't email the user twice.
   */
  async handleMessage(
    body: Record<string, any>,
    idempotencyKey?: string
  ): Promise<void> {
    const to = await this.resolveRecipient(body);
    if (!to) {
      this.logger.warn(
        `Could not resolve recipient for message: ${JSON.stringify(body)}`
      );
      return;
    }

    switch (body.type) {
      case "welcome_email":
        await this.send(
          { to, idempotencyKey },
          "Welcome to EZ Snippet!",
          this.welcomeHtml(body.email)
        );
        break;
      case "password_reset_email":
        await this.send(
          { to, idempotencyKey },
          "Reset your EZ Snippet password",
          this.passwordResetHtml(body.resetUrl)
        );
        break;
      case "subscription_confirmed":
        await this.send(
          { to, idempotencyKey },
          "Subscription Confirmed",
          this.subscriptionConfirmedHtml(body.orgName, body.plan)
        );
        break;
      case "subscription_canceled":
        await this.send(
          { to, idempotencyKey },
          "Subscription Canceled",
          this.subscriptionCanceledHtml(body.orgName, body.plan)
        );
        break;
      case "subscription_expired":
        await this.send(
          { to, idempotencyKey },
          "Subscription Expired",
          this.subscriptionExpiredHtml(body.orgName, body.plan)
        );
        break;
      case "payment_succeeded":
        await this.send(
          { to, idempotencyKey },
          "Payment Received",
          this.paymentSucceededHtml(
            body.orgName,
            body.plan,
            body.amountPaid,
            body.currency
          )
        );
        break;
      case "payment_failed":
        await this.send(
          { to, idempotencyKey },
          "Payment Failed",
          this.paymentFailedHtml(
            body.orgName,
            body.plan,
            body.amountDue,
            body.currency
          )
        );
        break;
      case "org_invite":
        await this.send(
          { to, idempotencyKey },
          `${body.inviterEmail ?? "Someone"} invited you to ${body.orgName} on EZ Snippet`,
          this.orgInviteHtml(
            body.orgName,
            body.inviterEmail,
            body.role,
            body.acceptUrl
          )
        );
        break;
      case "org_invite_accepted":
        await this.send(
          { to, idempotencyKey },
          `${body.memberEmail} joined ${body.orgName} on EZ Snippet`,
          this.orgInviteAcceptedHtml(body.orgName, body.memberEmail, body.role)
        );
        break;
      case "org_member_removed":
        await this.send(
          { to, idempotencyKey },
          `You've been removed from ${body.orgName} on EZ Snippet`,
          this.orgMemberRemovedHtml(body.orgName)
        );
        break;
      case "org_ownership_received":
        await this.send(
          { to, idempotencyKey },
          `You're now the owner of ${body.orgName} on EZ Snippet`,
          this.orgOwnershipReceivedHtml(
            body.orgName,
            body.fromEmail,
            body.billedToSomeoneElse === true
          )
        );
        break;
      default:
        this.logger.warn(`Unknown email type: ${body.type}`);
    }
  }

  private async resolveRecipient(
    body: Record<string, any>
  ): Promise<string | null> {
    // Invites go to someone who may not have an account yet.
    if (body.type === "org_invite") {
      return typeof body.email === "string" ? body.email : null;
    }

    // Welcome emails include userId directly
    if (body.userId) {
      const user = await this.userModel.findById(body.userId).exec();
      return user?.email || null;
    }

    // All other emails include orgId — find the org owner's email
    if (body.orgId) {
      const org = await this.orgModel.findById(body.orgId).exec();
      if (!org) return null;
      const owner = org.members?.find((m) => m.role === "owner");
      if (!owner) return null;
      const user = await this.userModel.findById(owner.user).exec();
      return user?.email || null;
    }

    return null;
  }

  private async send(
    { to, idempotencyKey }: { to: string; idempotencyKey?: string },
    subject: string,
    html: string
  ): Promise<void> {
    let result: Awaited<ReturnType<Resend["emails"]["send"]>>;
    try {
      result = await this.resend.emails.send(
        { from: this.from, to, subject, html },
        idempotencyKey ? { idempotencyKey } : undefined
      );
    } catch (err) {
      // Thrown rather than returned: the request never completed.
      throw new RetryableEmailError(
        `Resend request failed for ${to}: ${String(err)}`
      );
    }

    const { data, error } = result;
    if (error) {
      if (isRetryableResendError(error)) {
        throw new RetryableEmailError(
          `Resend ${error.statusCode ?? "no status"} ${error.name} for ${to}: ${error.message}`
        );
      }
      // Permanent: redelivering would fail identically, so report and let the
      // message be deleted. The recipient stays out of Sentry (no PII there).
      this.logger.error(
        `Dropping email "${subject}" to ${to}: ${error.statusCode} ${error.name} — ${error.message}`
      );
      Sentry.captureMessage(`Email dropped: Resend ${error.name}`, {
        level: "error",
        extra: { statusCode: error.statusCode, message: error.message, subject },
      });
      return;
    }

    this.logger.log(`Email sent to ${to} (id: ${data?.id})`);
  }

  private welcomeHtml(username: string): string {
    return `<h1>Welcome, ${escapeHtml(username)}!</h1>
    <p>Thanks for signing up for EZ Snippet. You're all set to start building beautiful pages with drag-and-drop snippets.</p>
    <p>If you have any questions, just reply to this email.</p>`;
  }

  private passwordResetHtml(resetUrl: string): string {
    const url = escapeHtml(resetUrl);
    return `<h1>Reset your password</h1>
    <p>We received a request to reset your EZ Snippet password. Click the link below to choose a new one:</p>
    <p><a href="${url}">${url}</a></p>
    <p>This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.</p>`;
  }

  // Every value below that came from a customer (emails, team/org names) is
  // escaped: these are sent from our domain, so unescaped HTML in a team name
  // or a signup email would let anyone send content that looks like ours.
  private orgInviteHtml(
    orgName: string,
    inviterEmail: string | null,
    role: string,
    acceptUrl: string
  ): string {
    const who = inviterEmail ? escapeHtml(inviterEmail) : "Someone";
    const url = escapeHtml(acceptUrl);
    return `<h1>You're invited to ${escapeHtml(orgName)}</h1>
    <p>${who} invited you to join <strong>${escapeHtml(orgName)}</strong> on EZ Snippet as ${role === "admin" ? "an admin" : "a member"}.</p>
    <p><a href="${url}">Accept the invitation</a></p>
    <p>Or paste this link into your browser: ${url}</p>
    <p>The link expires in 7 days. Sign in or create an account with this email address to accept it. If you weren't expecting this, you can ignore it.</p>`;
  }

  private orgInviteAcceptedHtml(
    orgName: string,
    memberEmail: string,
    role: string
  ): string {
    return `<h1>${escapeHtml(memberEmail)} joined ${escapeHtml(orgName)}</h1>
    <p><strong>${escapeHtml(memberEmail)}</strong> accepted your invitation and joined <strong>${escapeHtml(orgName)}</strong> as ${role === "admin" ? "an admin" : "a member"}.</p>
    <p>You can manage roles and seats from the Team page.</p>`;
  }

  private orgMemberRemovedHtml(orgName: string): string {
    return `<h1>You've been removed from ${escapeHtml(orgName)}</h1>
    <p>An owner or admin of <strong>${escapeHtml(orgName)}</strong> removed you from the team, so you no longer have access to its pages and layouts. Anything you created there stays with the team.</p>
    <p>Your personal workspace isn't affected. If you think this was a mistake, contact the team's owner.</p>`;
  }

  private orgOwnershipReceivedHtml(
    orgName: string,
    fromEmail: string | null,
    billedToSomeoneElse: boolean
  ): string {
    const who = fromEmail ? escapeHtml(fromEmail) : "The previous owner";
    const billing = billedToSomeoneElse
      ? `<p>The team's plan is still billed to the previous owner's payment details. To take it over, open <strong>Manage Billing</strong> on the Account page and update the payment method and billing details there.</p>`
      : "";
    return `<h1>You're now the owner of ${escapeHtml(orgName)}</h1>
    <p>${who} made you the owner of <strong>${escapeHtml(orgName)}</strong> on EZ Snippet. They're now an admin.</p>
    <p>As owner you manage billing, the team plan, custom domains and everyone's roles.</p>
    ${billing}`;
  }

  private subscriptionConfirmedHtml(orgName: string, plan: string): string {
    return `<h1>You're subscribed!</h1>
    <p>Your organization <strong>${escapeHtml(orgName)}</strong> is now on the <strong>${escapeHtml(plan)}</strong> plan.</p>
    <p>You can manage your subscription from your account settings at any time.</p>`;
  }

  private subscriptionCanceledHtml(orgName: string, plan: string): string {
    return `<h1>Subscription canceled</h1>
    <p>Your <strong>${escapeHtml(plan)}</strong> subscription for <strong>${escapeHtml(orgName)}</strong> has been canceled and will remain active until the end of your current billing period.</p>
    <p>You can resubscribe at any time from the pricing page.</p>`;
  }

  private subscriptionExpiredHtml(orgName: string, plan: string): string {
    return `<h1>Your subscription has ended</h1>
    <p>The <strong>${escapeHtml(plan)}</strong> subscription for <strong>${escapeHtml(orgName)}</strong> has expired.</p>
    <p>Resubscribe to regain access to your plan features.</p>`;
  }

  private paymentSucceededHtml(
    orgName: string,
    plan: string,
    amountPaid: string,
    currency: string
  ): string {
    return `<h1>Payment received</h1>
    <p>We've received your payment of <strong>${escapeHtml(amountPaid)} ${escapeHtml(String(currency ?? "").toUpperCase())}</strong> for the <strong>${escapeHtml(plan)}</strong> plan (${escapeHtml(orgName)}).</p>
    <p>No action is needed on your part.</p>`;
  }

  private paymentFailedHtml(
    orgName: string,
    plan: string,
    amountDue: string,
    currency: string
  ): string {
    return `<h1>Payment failed</h1>
    <p>We were unable to process your payment of <strong>${escapeHtml(amountDue)} ${escapeHtml(String(currency ?? "").toUpperCase())}</strong> for the <strong>${escapeHtml(plan)}</strong> plan (${escapeHtml(orgName)}).</p>
    <p>Please update your payment method in your account settings to avoid service interruption.</p>`;
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
