use anchor_lang::prelude::*;
use crate::errors::UniVibeError;
use crate::events::MilestoneSubmitted;
use crate::state::{Bounty, BountyStatus};

#[derive(Accounts)]
pub struct SubmitMilestone<'info> {
    #[account(
        mut,
        seeds = [b"bounty", bounty.sponsor.as_ref(), &bounty.bounty_id.to_le_bytes()],
        bump = bounty.bump,
        has_one = contributor @ UniVibeError::Unauthorized
    )]
    pub bounty: Account<'info, Bounty>,

    pub contributor: Signer<'info>,
}

pub fn handler(ctx: Context<SubmitMilestone>, deliverable_hash: [u8; 32]) -> Result<()> {
    require!(deliverable_hash != [0u8; 32], UniVibeError::InvalidDeliverableHash);
    let bounty = &mut ctx.accounts.bounty;

    require!(
        bounty.status == BountyStatus::Created || bounty.status == BountyStatus::Submitted,
        UniVibeError::InvalidStatusTransition
    );

    let current_time = Clock::get()?.unix_timestamp;
    require!(current_time <= bounty.deadline_timestamp, UniVibeError::DeadlineNotPassed);

    bounty.deliverable_hash = deliverable_hash;
    bounty.status = BountyStatus::Submitted;

    emit!(MilestoneSubmitted {
        bounty_id: bounty.bounty_id,
        contributor: bounty.contributor,
        deliverable_hash,
        submitted_at: current_time,
    });

    Ok(())
}