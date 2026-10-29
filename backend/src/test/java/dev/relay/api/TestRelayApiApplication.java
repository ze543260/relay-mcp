package dev.relay.api;

import org.springframework.boot.SpringApplication;

public class TestRelayApiApplication {

	public static void main(String[] args) {
		SpringApplication.from(RelayApiApplication::main).with(TestcontainersConfiguration.class).run(args);
	}

}
