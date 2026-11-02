<?php

namespace App\Domain\Filter;

/**
 * What a condition compares a field against, once its dynamic values are resolved: a range of days (`DayRange`) or a
 * plain value (`Scalar`).
 */
interface Operand {}
