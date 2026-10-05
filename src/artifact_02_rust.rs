use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("CmpP1seVibe111111111111111111111111111111111");

#[program]
pub mod campus_pulse {
    use super::*;

    /// Initializes a new grant program with dynamic milestone tracking.
    pub fn initialize_grant(
        ctx: Context<InitializeGrant>,
        grant_id: u64,
        title: String,
        total_budget: u64,
        milestone_count: u8,
    ) -> Result<()> {
        require!(title.len() > 0 && title.len() <= 64, PulseError::InvalidTitleLength);
        require!(milestone_count > 0 && milestone_count <= 10, PulseError::InvalidMilestoneCount);
        require!(total_budget > 0, PulseError::InvalidBudget);

        let grant = &mut ctx.accounts.grant;
        grant.grant_id = grant_id;
        grant.sponsor = ctx.accounts.sponsor.key();
        grant.recipient = ctx.accounts.recipient.key();
        grant.reviewer = ctx.accounts.reviewer.key();
        grant.total_budget = total_budget;
        grant.remaining_balance = total_budget;
        grant.milestone_count = milestone_count;
        grant.current_milestone = 0;
        grant.state = GrantState::Funded;
        grant.bump = ctx.bumps.grant;
        grant.vault_bump = ctx.bumps.vault;
        grant.title = title;

        // Transfer funds from sponsor to grant PDA vault
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.sponsor.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        );
        transfer(cpi_context, total_budget)?;

        emit!(GrantInitialized {
            grant_id,
            sponsor: ctx.accounts.sponsor.key(),
            recipient: ctx.accounts.recipient.key(),
            total_budget,
            milestone_count,
        });

        Ok(())
    }

    /// Recipient registers work deliverable for the active milestone.
    pub fn submit_milestone(
        ctx: Context<SubmitMilestone>,
        grant_id: u64,
        milestone_index: u8,
        proof_uri: String,
    ) -> Result<()> {
        let grant = &mut ctx.accounts.grant;
        require!(grant.state == GrantState::Funded || grant.state == GrantState::Active, PulseError::InvalidGrantState);
        require!(milestone_index == grant.current_milestone, PulseError::MilestoneSequenceError);
        require!(proof_uri.len() > 0 && proof_uri.len() <= 128, PulseError::InvalidProofUri);

        grant.state = GrantState::Submitted;

        emit!(MilestoneSubmitted {
            grant_id,
            milestone_index,
            proof_uri,
        });

        Ok(())
    }

    /// Authorized reviewer validates or rejects the submitted milestone.
    pub fn review_milestone(
        ctx: Context<ReviewMilestone>,
        grant_id: u64,
        milestone_index: u8,
        approved: bool,
    ) -> Result<()> {
        let grant = &mut ctx.accounts.grant;
        require!(grant.state == GrantState::Submitted, PulseError::NotUnderReview);
        require!(milestone_index == grant.current_milestone, PulseError::MilestoneSequenceError);

        if approved {
            grant.state = GrantState::Approved;
        } else {
            grant.state = GrantState::Disputed;
        }

        emit!(MilestoneReviewed {
            grant_id,
            milestone_index,
            approved,
            reviewer: ctx.accounts.reviewer.key(),
        });

        Ok(())
    }

    /// Disburses the pro-rata tranche to the student recipient upon approval.
    pub fn disburse_milestone(
        ctx: Context<DisburseMilestone>,
        grant_id: u64,
        milestone_index: u8,
    ) -> Result<()> {
        let grant = &mut ctx.accounts.grant;
        require!(grant.state == GrantState::Approved, PulseError::MilestoneNotApproved);
        require!(milestone_index == grant.current_milestone, PulseError::MilestoneSequenceError);

        // Calculate tranche allocation: balanced distribution with remainder on final tranche
        let tranche_amount = if grant.current_milestone == grant.milestone_count - 1 {
            grant.remaining_balance
        } else {
            grant.total_budget.checked_div(grant.milestone_count as u64).ok_or(PulseError::MathOverflow)?
        };

        require!(grant.remaining_balance >= tranche_amount, PulseError::InsufficientVaultFunds);

        let grant_id_bytes = grant_id.to_le_bytes();
        let seeds = &[
            b"vault".as_ref(),
            grant_id_bytes.as_ref(),
            &[grant.vault_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Transfer SOL from program vault PDA directly to student recipient
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.recipient.to_account_info(),
            },
            signer_seeds,
        );
        transfer(cpi_ctx, tranche_amount)?;

        grant.remaining_balance = grant.remaining_balance.checked_sub(tranche_amount).ok_or(PulseError::MathOverflow)?;
        grant.current_milestone = grant.current_milestone.checked_add(1).ok_or(PulseError::MathOverflow)?;

        if grant.current_milestone >= grant.milestone_count {
            grant.state = GrantState::Completed;
        } else {
            grant.state = GrantState::Active;
        }

        emit!(MilestoneDisbursed {
            grant_id,
            milestone_index,
            amount: tranche_amount,
            recipient: ctx.accounts.recipient.key(),
        });

        Ok(())
    }

    /// Sponsor emergency clawback if the milestone remains disputed or abandoned.
    pub fn emergency_clawback(
        ctx: Context<EmergencyClawback>,
        grant_id: u64,
    ) -> Result<()> {
        let grant = &mut ctx.accounts.grant;
        require!(grant.state == GrantState::Disputed, PulseError::GrantNotDisputed);
        require!(grant.remaining_balance > 0, PulseError::InsufficientVaultFunds);

        let grant_id_bytes = grant_id.to_le_bytes();
        let seeds = &[
            b"vault".as_ref(),
            grant_id_bytes.as_ref(),
            &[grant.vault_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let refund_amount = grant.remaining_balance;

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.sponsor.to_account_info(),
            },
            signer_seeds,
        );
        transfer(cpi_ctx, refund_amount)?;

        grant.remaining_balance = 0;
        grant.state = GrantState::Cancelled;

        emit!(GrantCancelled {
            grant_id,
            refund_amount,
            sponsor: ctx.accounts.sponsor.key(),
        });

        Ok(())
    }
}

// -----------------------------------------------------------------------------
// ACCOUNT VALIDATION CONTEXTS
// -----------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(grant_id: u64, title: String, total_budget: u64, milestone_count: u8)]
pub struct InitializeGrant<'info> {
    #[account(
        init,
        payer = sponsor,
        space = Grant::LEN,
        seeds = [b"grant", grant_id.to_le_bytes().as_ref()],
        bump
    )]
    pub grant: Account<'info, Grant>,

    /// CHECK: Vault PDA derived deterministically to hold lamports safely.
    #[account(
        mut,
        seeds = [b"vault", grant_id.to_le_bytes().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,

    #[account(mut)]
    pub sponsor: Signer<'info>,

    /// CHECK: Recipient pubkey verified by grant initializer.
    pub recipient: AccountInfo<'info>,

    /// CHECK: Reviewer authority responsible for attestations.
    pub reviewer: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(grant_id: u64)]
pub struct SubmitMilestone<'info> {
    #[account(
        mut,
        seeds = [b"grant", grant_id.to_le_bytes().as_ref()],
        bump = grant.bump,
        has_one = recipient @ PulseError::UnauthorizedRecipient
    )]
    pub grant: Account<'info, Grant>,

    pub recipient: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(grant_id: u64)]
pub struct ReviewMilestone<'info> {
    #[account(
        mut,
        seeds = [b"grant", grant_id.to_le_bytes().as_ref()],
        bump = grant.bump,
        has_one = reviewer @ PulseError::UnauthorizedReviewer
    )]
    pub grant: Account<'info, Grant>,

    pub reviewer: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(grant_id: u64)]
pub struct DisburseMilestone<'info> {
    #[account(
        mut,
        seeds = [b"grant", grant_id.to_le_bytes().as_ref()],
        bump = grant.bump,
        has_one = recipient @ PulseError::UnauthorizedRecipient
    )]
    pub grant: Account<'info, Grant>,

    /// CHECK: Vault PDA verified against seeds.
    #[account(
        mut,
        seeds = [b"vault", grant_id.to_le_bytes().as_ref()],
        bump = grant.vault_bump
    )]
    pub vault: AccountInfo<'info>,

    /// CHECK: Recipient receiving disbursed funds.
    #[account(mut)]
    pub recipient: AccountInfo<'info>,

    pub caller: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(grant_id: u64)]
pub struct EmergencyClawback<'info> {
    #[account(
        mut,
        seeds = [b"grant", grant_id.to_le_bytes().as_ref()],
        bump = grant.bump,
        has_one = sponsor @ PulseError::UnauthorizedSponsor
    )]
    pub grant: Account<'info, Grant>,

    /// CHECK: Vault PDA verified against seeds.
    #[account(
        mut,
        seeds = [b"vault", grant_id.to_le_bytes().as_ref()],
        bump = grant.vault_bump
    )]
    pub vault: AccountInfo<'info>,

    #[account(mut)]
    pub sponsor: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// -----------------------------------------------------------------------------
// STATE ENUMS & ACCOUNTS
// -----------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum GrantState {
    Funded,
    Active,
    Submitted,
    Approved,
    Disputed,
    Completed,
    Cancelled,
}

#[account]
pub struct Grant {
    pub grant_id: u64,              // 8
    pub sponsor: Pubkey,            // 32
    pub recipient: Pubkey,          // 32
    pub reviewer: Pubkey,           // 32
    pub total_budget: u64,          // 8
    pub remaining_balance: u64,     // 8
    pub current_milestone: u8,      // 1
    pub milestone_count: u8,        // 1
    pub state: GrantState,          // 1
    pub bump: u8,                   // 1
    pub vault_bump: u8,             // 1
    pub title: String,              // 4 + 64
}

impl Grant {
    pub const LEN: usize = 8 + 8 + 32 + 32 + 32 + 8 + 8 + 1 + 1 + 1 + 1 + 1 + (4 + 64);
}

// -----------------------------------------------------------------------------
// EVENTS
// -----------------------------------------------------------------------------

#[event]
pub mod events {
    use super::*;

    #[derive(AnchorSerialize, AnchorDeserialize)]
    pub struct GrantInitialized {
        pub grant_id: u64,
        pub sponsor: Pubkey,
        pub recipient: Pubkey,
        pub total_budget: u64,
        pub milestone_count: u8,
    }

    #[derive(AnchorSerialize, AnchorDeserialize)]
    pub struct MilestoneSubmitted {
        pub grant_id: u64,
        pub milestone_index: u8,
        pub proof_uri: String,
    }

    #[derive(AnchorSerialize, AnchorDeserialize)]
    pub struct MilestoneReviewed {
        pub grant_id: u64,
        pub milestone_index: u8,
        pub approved: bool,
        pub reviewer: Pubkey,
    }

    #[derive(AnchorSerialize, AnchorDeserialize)]
    pub struct MilestoneDisbursed {
        pub grant_id: u64,
        pub milestone_index: u8,
        pub amount: u64,
        pub recipient: Pubkey,
    }

    #[derive(AnchorSerialize, AnchorDeserialize)]
    pub struct GrantCancelled {
        pub grant_id: u64,
        pub refund_amount: u64,
        pub sponsor: Pubkey,
    }
}

pub use events::*;

// -----------------------------------------------------------------------------
// ERROR CODES
// -----------------------------------------------------------------------------

#[error_code]
pub enum PulseError {
    #[msg("Title must be between 1 and 64 characters.")]
    InvalidTitleLength,
    #[msg("Milestone count must be between 1 and 10.")]
    InvalidMilestoneCount,
    #[msg("Total budget must be greater than zero.")]
    InvalidBudget,
    #[msg("Grant is not in a valid state for this action.")]
    InvalidGrantState,
    #[msg("Milestone is out of chronological sequence.")]
    MilestoneSequenceError,
    #[msg("Proof URI exceeds limit or is empty.")]
    InvalidProofUri,
    #[msg("Milestone is not currently pending review.")]
    NotUnderReview,
    #[msg("Milestone must be approved prior to disbursement.")]
    MilestoneNotApproved,
    #[msg("Vault possesses insufficient lamport liquidity.")]
    InsufficientVaultFunds,
    #[msg("Arithmetic overflow occurred.")]
    MathOverflow,
    #[msg("Grant must be disputed prior to emergency clawback.")]
    GrantNotDisputed,
    #[msg("Caller is not the authorized recipient.")]
    UnauthorizedRecipient,
    #[msg("Caller is not the designated reviewer.")]
    UnauthorizedReviewer,
    #[msg("Caller is not the authorized sponsor.")]
    UnauthorizedSponsor,
}