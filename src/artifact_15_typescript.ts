import winston from 'winston';
import axios from 'axios';
import { Resend } from 'resend';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message }) => `[${timestamp}] ${level}: ${message}`)
  ),
  transports: [new winston.transports.Console()],
});

const resendClient = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

export async function sendEmailNotification(to: string, subject: string, htmlContent: string): Promise<void> {
  if (!resendClient) {
    logger.warn(`Resend API Key not configured. Skipping email dispatch to: ${to}`);
    return;
  }
  try {
    const response = await resendClient.emails.send({
      from: 'UniVibe Protocol <notifications@univibe.network>',
      to: [to],
      subject,
      html: htmlContent,
    });
    logger.info(`Resend alert successfully sent. ID: ${response.data?.id}`);
  } catch (error) {
    logger.error(`Failed to send email via Resend: ${error}`);
  }
}

export async function sendDiscordAuditAlert(title: string, description: string, fields: { name: string; value: string }[]): Promise<void> {
  if (!DISCORD_WEBHOOK_URL) {
    logger.warn('Discord Webhook URL not configured. Skipping chat alert.');
    return;
  }
  try {
    await axios.post(DISCORD_WEBHOOK_URL, {
      embeds: [
        {
          title: `[UniVibe On-Chain] ${title}`,
          description,
          color: 0x14f195, // Solana Emerald
          fields,
          footer: { text: 'UniVibe KUBG Event Monitor • Solana Mainnet/Devnet' },
          timestamp: new Date().toISOString(),
        },
      ],
    });
    logger.info(`Discord audit log broadcasted: ${title}`);
  } catch (error) {
    logger.error(`Discord webhook delivery failed: ${error}`);
  }
}