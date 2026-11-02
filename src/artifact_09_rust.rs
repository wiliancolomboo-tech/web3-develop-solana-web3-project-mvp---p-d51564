use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use crate::errors::UniVibeError;
use crate::events::BountyInitialized;
use crate::state::{Bounty, BountyStatus};

#[derive(Accounts)]
#[instruction(bounty_id: u64, title: String)]
pub struct InitializeBounty<'info> {
    #[account(
        init,
        payer = sponsor,
        space = Bounty::LEN,
        seeds = [b"bounty", sponsor.key().as_ref(), &bounty_id.to_le_bytes()],
        bump
    )]
    pub bounty: Account<'info, Bounty>,

    /// CHECK: Native lamport vault PDA controlled by program
    #[account(
        mut,
        seeds = [b"vault", bounty.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,

    /// CHECK: Valid contributor recipient account
    pub contributor: AccountInfo<'info>,

    /// CHECK: Campus arbitrator committee account
    pub arbitrator: AccountInfo<'info>,

    #[account(mut)]
    pub sponsor: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeBounty>,
    bounty_id: u64,
    title: String,
    amount: u64,
    deadline_timestamp: i64,
) -> Result<()> {
    require!(title.len() <= 64, UniVibeError::TitleTooLong);
    require!(amount > 0, UniVibeError::ZeroAmount);
    
    let current_time = Clock::get()?.unix_timestamp;
    require!(deadline_timestamp > current_time, UniVibeError::InvalidDeadline);

    // Transfer SOL from sponsor to the vault PDA
    let cpi_context = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        Transfer {
            from: ctx.accounts.sponsor.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        },
    );
    transfer(cpi_context, amount)?;

    // Populate Bounty PDA state
    let bounty = &mut ctx.accounts.bounty;
    bounty.bounty_id = bounty_id;
    bounty.sponsor = ctx.accounts.sponsor.key();
    bounty.contributor = ctx.accounts.contributor.key();
    bounty.arbitrator = ctx.accounts.arbitrator.key();
    bounty.amount = amount;
    bounty.deadline_timestamp = deadline_timestamp;
    bounty.status = BountyStatus::Created;
    bounty.deliverable_hash = [0u8; 32];
    bounty.bump = ctx.bumps.bounty;
    bounty.vault_bump = ctx.bumps.vault;
    bounty.title = title.clone();

    emit!(BountyInitialized {
        bounty_id,
        sponsor: ctx.accounts.sponsor.key(),
        contributor: ctx.accounts.contributor.key(),
        amount,
        deadline_timestamp,
        title,
    });

    Ok(())
}