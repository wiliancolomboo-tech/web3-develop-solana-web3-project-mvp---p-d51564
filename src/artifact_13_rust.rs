use anchor_lang::prelude::*;
use crate::errors::UniVibeError;
use crate::events::TimeoutRefunded;
use crate::state::{Bounty, BountyStatus};

#[derive(Accounts)]
pub struct ClaimTimeoutRefund<'info> {
    #[account(
        mut,
        seeds = [b"bounty", sponsor.key().as_ref(), &bounty.bounty_id.to_le_bytes()],
        bump = bounty.bump,
        has_one = sponsor @ UniVibeError::Unauthorized
    )]
    pub bounty: Account<'info, Bounty>,

    /// CHECK: Native lamport vault PDA
    #[account(
        mut,
        seeds = [b"vault", bounty.key().as_ref()],
        bump = bounty.vault_bump
    )]
    pub vault: AccountInfo<'info>,

    #[account(mut)]
    pub sponsor: Signer<'info>,
}

pub fn handler(ctx: Context<ClaimTimeoutRefund>) -> Result<()> {
    let bounty = &mut ctx.accounts.bounty;
    let current_time = Clock::get()?.unix_timestamp;

    // Must be past deadline and never successfully submitted or approved
    require!(current_time > bounty.deadline_timestamp, UniVibeError::DeadlineNotPassed);
    require!(bounty.status == BountyStatus::Created, UniVibeError::InvalidStatusTransition);

    let refund_amount = bounty.amount;
    let vault_balance = ctx.accounts.vault.lamports();
    require!(vault_balance >= refund_amount, UniVibeError::ArithmeticOverflow);

    // Transfer back to sponsor
    **ctx.accounts.vault.try_borrow_mut_lamports()? -= refund_amount;
    **ctx.accounts.sponsor.try_borrow_mut_lamports()? += refund_amount;

    bounty.status = BountyStatus::Refunded;

    emit!(TimeoutRefunded {
        bounty_id: bounty.bounty_id,
        sponsor: ctx.accounts.sponsor.key(),
        amount: refund_amount,
    });

    Ok(())
}