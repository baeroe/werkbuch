<?php

namespace App\Enums;

enum EnsureAdminOutcome: string
{
    case Created = 'created';
    case Exists = 'exists';
    case AccountsExist = 'accounts_exist';
    case NotConfigured = 'not_configured';
}
