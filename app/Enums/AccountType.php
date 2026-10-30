<?php

namespace App\Enums;

enum AccountType: string
{
    case Person = 'person';
    case Bot = 'bot';
}
