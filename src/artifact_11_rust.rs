use anchor_lang::prelude::*;
use crate::errors::UniVibeError;
use crate::events::FundsDisbursed;
use crate::state::{Bounty, BountyStatus};

#[derive(Accounts)]
pub struct ApproveAndDisburse<'info> {
    #[account(
        mut,
        seeds = [b"bounty", bounty.sponsor.as_ref(), &bounty.bounty_id.to_le_bytes()],
        bump = bounty.bump,
        has_one = sponsor @ UniVibeError::Unauthorized,
        has_one = contributor @ UniVibeError::Unauthorized
    )]
    pub bounty: Account<'info, Bounty>,

    /// CHECK: Native lamport vault PDA controlled by program seeds
    #[account(
        mut,
        seeds = [b"vault", bounty.key().as_ref()],
        bump = bounty.vault_bump
    )]
    pub vault: AccountInfo<'info>,

    /// CHECK: Recipient contributor wallet
    #[account(mut)]
    pub contributor: AccountInfo<'info>,

    pub sponsor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ApproveAndDisburse>) -> Result<()> {
    let bounty = &mut ctx.accounts.bounty;
    require!(bounty.status == BountyStatus::Submitted, UniVibeError::InvalidStatusTransition);

    let amount = bounty.amount;
    let bounty_key = bounty.key();

    // Check vault holds sufficient balance
    let vault_balance = ctx.accounts.vault.lamports();
    require!(vault_balance >= amount, UniVibeError::ArithmeticOverflow);

    // Perform direct lamport transfer using program account manipulation from PDA
    **ctx.accounts.vault.try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.contributor.try_borrow_mut_lamports()? += amount;

    bounty.status = BountyStatus::Completed;

    let current_time = Clock::get()?.unix_timestamp;
    emit!(FundsDisbursed {
        bounty_id: bounty.bounty_id,
        contributor: bounty.contributor,
        amount,
        disbursed_at: current_time,
    });

    Ok(())
}