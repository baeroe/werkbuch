<?php

namespace App\Domain\Schedule;

/** How often the schedule of a template repeats (spec 4.12). */
enum Frequency: string
{
    case Daily = 'daily';
    case Weekly = 'weekly';
    case Monthly = 'monthly';
    case Yearly = 'yearly';
}
