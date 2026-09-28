import { Inject, Injectable, Logger } from "@nestjs/common";
import { Resend } from "resend";
import { Model } from "mongoose";

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

  async handleMessage(body: Record<string, any>): Promise<void> {
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
          to,
          "Welcome to EZ Snippet!",
          this.welcomeHtml(body.email)
        );
        break;
      case "password_reset_email":
        await this.send(
          to,
          "Reset your EZ Snippet password",
          this.passwordResetHtml(body.resetUrl)
        );
        break;
      case "subscription_confirmed":
        await this.send(
          to,
          "Subscription Confirmed",
          this.subscriptionConfirmedHtml(body.orgName, body.plan)
        );
        break;
      case "subscription_canceled":
        await this.send(
          to,
          "Subscription Canceled",
          this.subscriptionCanceledHtml(body.orgName, body.plan)
        );
        break;
      case "subscription_expired":
        await this.send(
          to,
          "Subscription Expired",
          this.subscriptionExpiredHtml(body.orgName, body.plan)
        );
        break;
      case "payment_succeeded":
        await this.send(
          to,
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
          to,
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
          to,
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
          to,
          `${body.memberEmail} joined ${body.orgName} on EZ Snippet`,
          this.orgInviteAcceptedHtml(body.orgName, body.memberEmail, body.role)
        );
        break;
      case "org_member_removed":
        await this.send(
          to,
          `You've been removed from ${body.orgName} on EZ Snippet`,
          this.orgMemberRemovedHtml(body.orgName)
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

  private async send(to: string, subject: string, html: string): Promise<void> {
    try {
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to,
        subject,
        html,
      });

      if (error) {
        this.logger.error(`Failed to send email to ${to}: ${error.message}`);
        return;
      }

      this.logger.log(`Email sent to ${to} (id: ${data?.id})`);
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}`, err);
    }
  }

  private welcomeHtml(username: string): string {
    return `<h1>Welcome, ${username}!</h1>
    <p>Thanks for signing up for EZ Snippet. You're all set to start building beautiful pages with drag-and-drop snippets.</p>
    <p>If you have any questions, just reply to this email.</p>`;
  }

  private passwordResetHtml(resetUrl: string): string {
    return `<h1>Reset your password</h1>
    <p>We received a request to reset your EZ Snippet password. Click the link below to choose a new one:</p>
    <p><a href="${resetUrl}">${resetUrl}</a></p>
    <p>This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.</p>`;
  }

  // Team emails carry text customers control (the team name, the member's
  // email) and can reach people outside the sender's org, so they're escaped.
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

  private subscriptionConfirmedHtml(orgName: string, plan: string): string {
    return `<h1>You're subscribed!</h1>
    <p>Your organization <strong>${orgName}</strong> is now on the <strong>${plan}</strong> plan.</p>
    <p>You can manage your subscription from your account settings at any time.</p>`;
  }

  private subscriptionCanceledHtml(orgName: string, plan: string): string {
    return `<h1>Subscription canceled</h1>
    <p>Your <strong>${plan}</strong> subscription for <strong>${orgName}</strong> has been canceled and will remain active until the end of your current billing period.</p>
    <p>You can resubscribe at any time from the pricing page.</p>`;
  }

  private subscriptionExpiredHtml(orgName: string, plan: string): string {
    return `<h1>Your subscription has ended</h1>
    <p>The <strong>${plan}</strong> subscription for <strong>${orgName}</strong> has expired.</p>
    <p>Resubscribe to regain access to your plan features.</p>`;
  }

  private paymentSucceededHtml(
    orgName: string,
    plan: string,
    amountPaid: string,
    currency: string
  ): string {
    return `<h1>Payment received</h1>
    <p>We've received your payment of <strong>${amountPaid} ${currency.toUpperCase()}</strong> for the <strong>${plan}</strong> plan (${orgName}).</p>
    <p>No action is needed on your part.</p>`;
  }

  private paymentFailedHtml(
    orgName: string,
    plan: string,
    amountDue: string,
    currency: string
  ): string {
    return `<h1>Payment failed</h1>
    <p>We were unable to process your payment of <strong>${amountDue} ${currency.toUpperCase()}</strong> for the <strong>${plan}</strong> plan (${orgName}).</p>
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
