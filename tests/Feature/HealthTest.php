<?php

it('answers the health check', fn () => $this->get('/up')->assertOk());
