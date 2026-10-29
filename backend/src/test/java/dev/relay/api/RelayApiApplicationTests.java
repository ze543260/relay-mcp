package dev.relay.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
@AutoConfigureMockMvc
class RelayApiApplicationTests {

	@Autowired
	MockMvc mvc;

	@Test
	void probesAreOpen() throws Exception {
		mvc.perform(get("/livez")).andExpect(status().isOk());
		mvc.perform(get("/readyz")).andExpect(status().isOk());
	}

	@Test
	void openApiContractIsPublished() throws Exception {
		mvc.perform(get("/openapi.json")).andExpect(status().isOk());
	}

	@Test
	void businessRoutesRequireAuthentication() throws Exception {
		mvc.perform(get("/messages")).andExpect(status().isUnauthorized());
		mvc.perform(get("/mcp")).andExpect(status().isUnauthorized());
	}

}
